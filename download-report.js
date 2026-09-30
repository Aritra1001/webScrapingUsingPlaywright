// Downloads monthly reports from any site configured under sites/<site-id>/config.js.
//
//   node download-report.js --site strava
//   node download-report.js --site <site-id> --month previous      (or current, or 2026-08)
//   node download-report.js --site <site-id> --manual-login        (log in by hand this time)
//
// See sites/_template/config.js for how to add a site.
const path = require('path');
const { parseArgs } = require('util');
const { log, logTo } = require('./core/log');
const { resolveMonth, periodVars } = require('./core/util');
const { loadSite, listSites } = require('./core/config');
const { launchChrome, attach, findPage, acceptCookies, closeChrome } = require('./core/browser');
const { autoLogin, waitForLogin } = require('./core/login');
const { runSteps } = require('./core/steps');
const { runReport } = require('./core/reports');

function usage(message) {
    if (message) console.log(`${message}\n`);
    console.log('Usage: node download-report.js --site <site-id> [--month current|previous|YYYY-MM] [--manual-login]');
    console.log(`Configured sites: ${listSites().join(', ') || '(none)'}`);
    process.exit(1);
}

(async () => {
    let args;
    try {
        ({ values: args } = parseArgs({
            options: {
                site: { type: 'string' },
                month: { type: 'string' },
                'manual-login': { type: 'boolean' },
            },
        }));
    } catch (e) {
        usage(e.message);
    }
    if (!args.site) usage('Which site? Pass --site.');

    let site;
    let vars;
    try {
        site = loadSite(args.site);
        vars = periodVars(resolveMonth(args.month || site.period));
    } catch (e) {
        usage(e.message);
    }
    if (site.login && args['manual-login']) site.login.mode = 'assisted';

    logTo(path.join(__dirname, 'logs', `${site.id}.log`));
    log(`${site.name} — report for ${vars.monthName} ${vars.yyyy}`);

    // --- Step 1: open the login page (or the start page of a site without a login) --------
    log(`Step 1: opening ${site.startUrl} in Chrome...`);
    const chrome = launchChrome(site, site.startUrl);

    // --- Step 2: log in — filled from Credential Manager, finished by you where needed -----
    if (site.login) {
        const prompted = site.login.mode === 'auto' ? await autoLogin(site) : false;
        await waitForLogin(site, prompted);
    }

    // --- Step 3: logged in; attach and take over the same window --------------------------
    const browser = await attach(site);
    if (!browser) {
        log('Could not attach to Chrome.');
        chrome.kill();
        process.exit(1);
    }
    const context = browser.contexts()[0];
    const landing = site.login ? site.login.loggedInUrl : new URL(site.startUrl).origin;
    const page = await findPage(context, landing, 5) || await context.newPage();
    page.setDefaultNavigationTimeout(60000);
    page.setDefaultTimeout(30000);

    let failed = false;
    try {
        if (site.login) log('Logged in.');
        await acceptCookies(page, site.cookieAccept);

        // --- Step 4: navigate to the report ------------------------------------------------
        log('Step 4: navigating...');
        await runSteps(page, site.steps, vars);

        // --- Step 5: download it -----------------------------------------------------------
        log(`Step 5: getting the report (${site.report.type})...`);
        await runReport(site, { browser, page, vars });
    } catch (err) {
        // Closing the browser mid-wait surfaces as a page/target error, which is expected.
        if (browser.isConnected()) {
            failed = true;
            log('\n--- Script failed ---');
            log(err.message);
            log(`Page was on: ${page.url()}`);
        }
    }

    log('\nDone.');
    await closeChrome(browser, chrome);
    process.exit(failed ? 1 : 0);
})();
