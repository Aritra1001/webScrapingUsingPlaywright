const fs = require('fs');
const path = require('path');
const { log } = require('../../core/log');
const { sleep, MONTH_NAMES, periodVars, toCsv } = require('../../core/util');

const DEBUG_FILE = path.join(__dirname, '..', '..', 'logs', 'strava-entries.json');

// The selected month lives in the URL fragment as interval=YYYYMM, e.g. interval=202609.
// Weekly view uses the same parameter for week numbers (interval=202638 = week 38), so
// only trust it when the chart is actually in month mode and MM is a real month.
function selectedMonth(url) {
    if (!/interval_type=month/.test(url)) return null;
    const match = url.match(/interval=(\d{4})(\d{2})/);
    if (!match) return null;
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

// "September 15, 2026 at 8:30 PM" -> "2026-09"
function rowMonth(date) {
    const match = String(date == null ? '' : date).match(/^([A-Za-z]+)\s+\d+,\s+(\d{4})/);
    const index = match ? MONTH_NAMES.indexOf(match[1]) : -1;
    return index < 0 ? null : `${match[2]}-${String(index + 1).padStart(2, '0')}`;
}

// #interval-rides is a React microfrontend mount point — the month's activities are never
// rendered as <a href="/activities/..."> links. They ship as JSON in data-react-props,
// which is also where the browser extension reads its numbers from.
async function scrapeMonth(page) {
    return page.evaluate(() => {
        const mount = document.querySelector('#interval-rides [data-react-props]');
        if (!mount) return { error: 'no react mount inside #interval-rides' };

        let props;
        try {
            props = JSON.parse(mount.getAttribute('data-react-props'));
        } catch (e) {
            return { error: `could not parse data-react-props: ${e.message}` };
        }

        const entries = (props.appContext && props.appContext.preFetchedEntries) || [];
        const strip = (html) => String(html == null ? '' : html).replace(/<[^>]*>/g, '').trim();

        // stats is a flat list where each value is followed by its label, e.g.
        // [{value:"3.03<abbr> km</abbr>"}, {value:"Distance"}] — so the value sits at i-1.
        const stat = (stats, label) => {
            const i = (stats || []).findIndex((s) => s.value === label);
            return i < 1 ? '' : strip(stats[i - 1].value);
        };

        const rows = [];
        for (const entry of entries) {
            const activity = entry.activity;
            if (!activity) continue;
            const where = entry.timeAndLocation || activity.timeAndLocation || {};

            rows.push({
                activityId: activity.id || activity.entity_id || '',
                athlete: (activity.athlete && activity.athlete.athleteName) || activity.athlete_name || '',
                title: activity.activityName || activity.name || '',
                type: activity.type || '',
                date: where.displayDateAtTime || '',
                location: where.location || '',
                distance: stat(activity.stats, 'Distance'),
                pace: stat(activity.stats, 'Pace'),
                time: stat(activity.stats, 'Time'),
                elevation: stat(activity.stats, 'Elev Gain'),
                calories: stat(activity.stats, 'Cal'),
            });
        }

        return {
            rows,
            heading: (document.querySelector('#interval-value') || {}).textContent || '',
            totals: ((document.querySelector('#totals') || {}).innerText || '').replace(/\s+/g, ' ').trim(),
            raw: JSON.stringify(entries),
        };
    }).catch((e) => ({ error: `page changed while reading it (${e.message.split('\n')[0]})` }));
}

// The heading above the chart reads e.g. "Activities for Sep 2025", so when it is readable it
// states exactly which month is on screen — the only trustworthy signal for a month that
// legitimately has no activities at all. "Sep 2025" / "September 2025" -> "2025-09".
function headingMonth(heading) {
    const match = String(heading == null ? '' : heading).match(/([A-Z][a-z]{2})[a-z]*\s+(\d{4})/);
    const index = match ? MONTH_NAMES.findIndex((m) => m.startsWith(match[1])) : -1;
    return index < 0 ? null : `${match[2]}-${String(index + 1).padStart(2, '0')}`;
}

// Clicking a month on the chart only rewrites the URL fragment; that month's entries arrive
// over the network afterwards. Scraping straight away therefore captures whatever month was
// still on screen, so wait until the page actually agrees with the month we asked for.
async function scrapeMonthWhenReady(page, month, timeoutMs = 20000, settleMs = 4000) {
    const started = Date.now();
    let last = null;

    while (Date.now() - started < timeoutMs) {
        const result = await scrapeMonth(page);
        if (result.error) return result;
        last = result;

        const shown = headingMonth(result.heading);
        const months = result.rows.map((r) => rowMonth(r.date)).filter(Boolean);

        if (shown === null || shown === month) {
            if (months.length) {
                if (months.every((m) => m === month)) return result;
            } else if (shown === month || Date.now() - started >= settleMs) {
                // No activities this month. Trusted at once when the heading confirms the
                // month, otherwise only after the page has had a moment to load something.
                return result;
            }
        }

        await sleep(1000);
    }

    const seen = String((last && last.heading) || '').trim();
    return { error: `page never settled on ${month} within ${timeoutMs / 1000}s — nothing written` +
        (seen ? ` (heading still reads "${seen}")` : '') };
}

const CSV_COLUMNS = [
    ['Athlete', (r, ctx) => r.athlete || ctx.athleteName],
    ['Month', (r, ctx) => ctx.month],
    ['Date', (r) => r.date],
    ['ActivityId', (r) => r.activityId],
    ['Activity', (r) => r.title],
    ['Type', (r) => r.type],
    ['Location', (r) => r.location],
    ['Distance', (r) => r.distance],
    ['Pace', (r) => r.pace],
    ['Time', (r) => r.time],
    ['Elevation', (r) => r.elevation],
    ['Calories', (r) => r.calories],
    ['MonthTotals', (r, ctx) => ctx.totals],
];

// You click members on the club's members list; each profile's chart is flipped to Monthly
// and the month on screen is saved. Runs until the browser is closed.
module.exports = async function stravaReport({ browser, page, outputFile }) {
    log('\nReady. Click a member to download their monthly report.');
    log('Go back to the members list and pick another to download the next one.');
    log('Switching months on the chart downloads that month too. Close the browser to stop.\n');

    let lastAthleteId = null;
    let lastDownloaded = null;

    while (browser.isConnected()) {
        const url = page.url();
        const athleteId = (url.match(/\/athletes\/(\d+)/) || [])[1];

        if (!athleteId) {
            // Forget the athlete on the way out, so re-opening the same profile counts as
            // a new arrival and gets its chart flipped to Monthly again.
            lastAthleteId = null;
            await sleep(1500); // not on a profile (members list, club page, ...)
            continue;
        }

        // A freshly opened profile defaults to the weekly chart, so flip it to Monthly.
        if (athleteId !== lastAthleteId) {
            lastAthleteId = athleteId;
            const monthly = page.locator('#interval-graph-controls')
                .getByRole('link', { name: 'Monthly' });
            await monthly.click({ timeout: 15000 }).catch(() => log('  (no Monthly toggle on this page yet)'));
            await sleep(3000); // the chart re-renders the interval client-side
            continue;
        }

        const month = selectedMonth(page.url());
        const key = `${athleteId}:${month}`;
        if (!month || key === lastDownloaded) {
            await sleep(1500);
            continue;
        }

        const athleteName = (await page.locator('h1').first().textContent().catch(() => '') || '')
            .trim() || `athlete-${athleteId}`;

        const result = await scrapeMonthWhenReady(page, month);
        if (result.error) {
            log(`  ${athleteName}: ${result.error}`);
            lastDownloaded = key;
            continue;
        }

        fs.mkdirSync(path.dirname(DEBUG_FILE), { recursive: true });
        fs.writeFileSync(DEBUG_FILE, result.raw);

        const ctx = { athleteName, month, totals: result.totals };
        const outFile = outputFile({ ...periodVars(month), athlete: athleteName, ext: '.csv' });
        fs.writeFileSync(outFile, toCsv([
            CSV_COLUMNS.map(([name]) => name),
            ...result.rows.map((r) => CSV_COLUMNS.map(([, get]) => get(r, ctx))),
        ]));
        lastDownloaded = key;

        log(`${athleteName} — ${month}: ${result.rows.length} activities, totals "${result.totals}"`);
        log(`  -> ${outFile}`);
    }
};
