const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUTH_FILE = path.join(__dirname, 'auth.json');
const PROFILE_DIR = path.join(__dirname, 'chrome-profile');
const REPORTS_DIR = path.join(__dirname, 'reports');
const LOG_FILE = path.join(__dirname, 'run.log');
const DEBUG_HTML = path.join(__dirname, 'interval-entries.json');

const LOGIN_URL = 'https://www.strava.com/login';
const DASHBOARD_URL = 'https://www.strava.com/dashboard';
const CLUB_URL = 'https://www.strava.com/clubs/GainInsights';
const CLUB_MEMBERS_URL = 'https://www.strava.com/clubs/976969/members';

// How the login is done. 'auto' fills the username (and password, if the site asks for one)
// from Windows Credential Manager and hands over to you only for the captcha / emailed code.
// 'assisted' leaves the whole login to you. `node download-report.js --manual-login` forces it.
const LOGIN = {
    mode: process.argv.includes('--manual-login') ? 'assisted' : 'auto',
    credential: 'ReportDownloader:strava', // Generic credential name in Credential Manager
    // Strava renders a desktop and a mobile copy of the form (#desktop-email / #mobile-email)
    // depending on the window width, so match whichever one is visible.
    // "Remember me" is ticked by default, so it is left alone.
    usernameField: 'input[name=email]:visible',
    submit: 'button[id$=-login-button]:visible',
    passwordField: 'input[type=password]',
    codeText: /sent you a code|verification code|enter (the|your) code/i,
    rejectedText: /unexpected error occurred/i,
};

const DEVTOOLS_PORT = 9222;
const DEVTOOLS = `http://127.0.0.1:${DEVTOOLS_PORT}`;
const CHROME_PATHS = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.writeFileSync(LOG_FILE, '');
const log = (message) => {
    console.log(message);
    fs.appendFileSync(LOG_FILE, `${message}\n`);
};

// Accepting the consent banner sets a CookieConsent cookie that gets saved into auth.json,
// so later runs don't see the banner at all.
async function acceptCookieBanner(page) {
    const accept = page.getByRole('button', { name: 'Accept All' });
    try {
        await accept.waitFor({ state: 'visible', timeout: 5000 });
        await accept.click();
        await page.context().storageState({ path: AUTH_FILE });
        log('Accepted the cookie consent banner.');
    } catch {
        // Not shown this time (consent already stored).
    }
}

// Strava's login is guarded by reCAPTCHA Enterprise, which rejects logins made in
// Playwright's own browser (it reports navigator.webdriver = true). So the run uses the
// installed Chrome, and the script only attaches to it after the login is finished.
function launchChrome(url) {
    const chromePath = CHROME_PATHS.find((p) => fs.existsSync(p));
    if (!chromePath) {
        log('Google Chrome not found. Set CHROME_PATH to chrome.exe and retry.');
        process.exit(1);
    }

    // Chrome only allows remote debugging on a non-default profile. This one also keeps the
    // Strava session between runs, so later runs usually skip the login altogether.
    return spawn(chromePath, [
        `--remote-debugging-port=${DEVTOOLS_PORT}`,
        `--user-data-dir=${PROFILE_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        url,
    ], { stdio: 'ignore' });
}

// The login (email -> Log In -> emailed code -> Next) is done entirely by hand. Polling the
// DevTools HTTP endpoint lists Chrome's tabs without attaching to them, so nothing touches
// the page meanwhile. Strava only keeps a logged-in user on /dashboard — but a tab still
// loading /dashboard reports that URL briefly before bouncing to /login, so it must be seen
// on two polls in a row. No timeout.
async function waitForManualLogin(prompted = false) {
    let onDashboard = 0;
    for (let tick = 1; ; tick++) {
        await sleep(2000);
        const tabs = await fetch(`${DEVTOOLS}/json/list`).then((r) => r.json()).catch(() => []);
        const pages = tabs.filter((t) => t.type === 'page');

        onDashboard = pages.some((t) => t.url.startsWith(DASHBOARD_URL)) ? onDashboard + 1 : 0;
        if (onDashboard >= 2) return;

        if (!prompted && pages.some((t) => t.url.startsWith(LOGIN_URL))) {
            log('>>> Log in manually in the Chrome window (email, Log In, the emailed code, Next). <<<');
            prompted = true;
        }
        if (tick % 15 === 0) log('  ...waiting for you to finish logging in');
    }
}

// Reads a Generic credential (Control Panel -> Credential Manager -> Windows Credentials) by
// its name. The password never reaches the log or any file.
function readCredential(name) {
    try {
        const { findCredentials } = require('@napi-rs/keyring');
        const [cred] = findCredentials(name, name);
        return cred ? { username: cred.account, password: cred.password || '' } : null;
    } catch (e) {
        log(`Could not read Windows Credential Manager: ${e.message}`);
        return null;
    }
}

// Attaches to the Chrome that launchChrome() just started, fills in what it can from the
// stored credential, then detaches again so nothing is attached while you solve the captcha
// or type the emailed code. Returns true when it has already told you what to do next.
async function autoLogin() {
    const cred = readCredential(LOGIN.credential);
    if (!cred || !cred.username) {
        log(`No credential "${LOGIN.credential}" in Windows Credential Manager — log in by hand.`);
        log('  (Add it as a Generic Credential to let the script fill the login in next time.)');
        return false;
    }

    let browser = null;
    for (let i = 0; i < 30 && !browser; i++) {
        browser = await chromium.connectOverCDP(DEVTOOLS).catch(() => null);
        if (!browser) await sleep(1000); // Chrome is still starting up
    }
    if (!browser) {
        log('Could not attach to Chrome for the automatic login — log in by hand.');
        return false;
    }

    try {
        const context = browser.contexts()[0];
        let page = null;
        for (let i = 0; i < 30 && !page; i++) {
            page = context.pages().find((p) => p.url().startsWith('https://www.strava.com'));
            if (!page) await sleep(1000);
        }
        if (!page) throw new Error('the Strava tab did not open');
        await page.waitForLoadState('domcontentloaded');
        await acceptCookieBanner(page);

        // A saved session skips the login entirely. Asking the server is the only reliable
        // check: an expired session leaves its remember-me cookies behind.
        const loggedIn = await page.evaluate(() => fetch('/dashboard', { redirect: 'manual' })
            .then((r) => r.ok && r.type !== 'opaqueredirect')).catch(() => false);
        if (loggedIn) {
            log('Already logged in (saved session).');
            await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
            return true;
        }

        log(`Filling in the login as ${cred.username} (from Credential Manager)...`);
        await page.locator(LOGIN.usernameField).fill(cred.username, { timeout: 30000 });
        await page.locator(LOGIN.submit).click();

        // Wait for whatever Strava shows next.
        let passwordFilled = false;
        let outcome = 'unknown';
        for (let i = 0; i < 30 && outcome === 'unknown'; i++) {
            await sleep(500);
            if (page.url().startsWith(DASHBOARD_URL)) {
                outcome = 'dashboard';
                break;
            }
            const text = await page.locator('body').innerText().catch(() => '');
            if (LOGIN.rejectedText.test(text)) outcome = 'rejected';
            else if (LOGIN.codeText.test(text)) outcome = 'code';
            else if (!passwordFilled && await page.locator(LOGIN.passwordField).first().isVisible().catch(() => false)) {
                if (!cred.password) {
                    outcome = 'password';
                } else {
                    await page.locator(LOGIN.passwordField).first().fill(cred.password);
                    await page.locator(LOGIN.passwordField).first().press('Enter');
                    passwordFilled = true;
                }
            }
        }

        if (outcome === 'dashboard') {
            log('Logged in automatically.');
            return true;
        }

        await page.bringToFront().catch(() => {});
        process.stdout.write('\x07'); // terminal bell
        if (outcome === 'rejected') {
            log('>>> Strava rejected the automatic login ("unexpected error"). <<<');
            log('>>> Please finish the login by hand in the Chrome window. <<<');
        } else if (outcome === 'code') {
            log('>>> Strava emailed you a code — type it into the Chrome window and click Next. <<<');
        } else if (outcome === 'password') {
            log('>>> Strava wants a password, but the credential has none — type it in the Chrome window. <<<');
        } else {
            log('>>> Please finish the login in the Chrome window (captcha / code). <<<');
        }
        log('    Waiting until you reach the dashboard - no timeout.');
        return true;
    } catch (e) {
        log(`Automatic login stopped (${e.message.split('\n')[0]}) — please finish logging in by hand.`);
        return false;
    } finally {
        // Detaches only: Chrome and its tabs stay open.
        await browser.close().catch(() => {});
    }
}

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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// "2026-09" -> "September"
function monthName(month) {
    return MONTH_NAMES[Number(month.slice(5, 7)) - 1] || month;
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

function toCsv(rows, ctx) {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [CSV_COLUMNS.map(([name]) => esc(name)).join(',')];
    for (const r of rows) {
        lines.push(CSV_COLUMNS.map(([, get]) => esc(get(r, ctx))).join(','));
    }
    return lines.join('\n') + '\n';
}

(async () => {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    // --- Step 1: open the login page (if already logged in, Strava moves on to /dashboard) ---
    log('Step 1: opening the Strava login page in Chrome...');
    const chrome = launchChrome(LOGIN_URL);

    // --- Step 2: log in — filled from Credential Manager, finished by you where needed ---
    const prompted = LOGIN.mode === 'auto' ? await autoLogin() : false;
    await waitForManualLogin(prompted);

    // --- Step 3: logged in; only now attach and take over the same window ---------------
    const browser = await chromium.connectOverCDP(DEVTOOLS);
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url().startsWith(DASHBOARD_URL))
        || await context.newPage();
    page.setDefaultNavigationTimeout(60000);

    try {
        await context.storageState({ path: AUTH_FILE });
        log(`Logged in. Session saved to ${AUTH_FILE}`);

        log('Step 3: opening the dashboard...');
        await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
        await acceptCookieBanner(page);

        // --- Step 1b: dashboard -> club page --------------------------------------------
        log(`Step 1: navigating to the club page ${CLUB_URL}...`);
        await page.goto(CLUB_URL, { waitUntil: 'domcontentloaded' });

        // --- Step 2/3: club page -> members list ----------------------------------------
        log(`Step 2: navigating to the members list ${CLUB_MEMBERS_URL}...`);
        await page.goto(CLUB_MEMBERS_URL, { waitUntil: 'domcontentloaded' });
        log(`Step 3: members list open — ${await page.title()}`);

        // --- Steps 4-7, on a loop so one session can cover many members -----------------
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

            fs.writeFileSync(DEBUG_HTML, result.raw);

            // Requested filename format: ATHLETE_NAME_MONTH_NAME_YYYY.csv
            const safeName = athleteName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
            const outFile = path.join(REPORTS_DIR, `${safeName}_${monthName(month)}_${month.slice(0, 4)}.csv`);

            fs.writeFileSync(outFile, toCsv(result.rows, { athleteName, month, totals: result.totals }));
            lastDownloaded = key;

            log(`${athleteName} — ${month}: ${result.rows.length} activities, totals "${result.totals}"`);
            log(`  -> ${outFile}`);
        }
    } catch (err) {
        // Closing the browser mid-wait surfaces as a page/target error, which is expected.
        if (browser.isConnected()) {
            log('\n--- Script failed ---');
            log(err.message);
            log(`Page was on: ${page.url()}`);
        }
    }

    log('\nBrowser closed. Done.');
    chrome.kill();
    process.exit(0);
})();
