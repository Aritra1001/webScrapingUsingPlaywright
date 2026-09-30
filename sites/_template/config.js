// Template for a new site. To add one:
//   1. Copy this folder to sites/<site-id>  (e.g. sites/acme). Folders starting with _ are ignored.
//   2. Fill in the options below and delete the ones you don't need.
//   3. If it logs in, add a Generic Credential named in login.credential (see README / below).
//   4. Run:  node download-report.js --site <site-id> [--month current|previous|YYYY-MM]
//
// Placeholders: any URL, step value or file name can use these, filled in for the chosen month:
//   {yyyy} 2026   {mm} 09   {yyyymm} 202609   {month} 2026-09
//   {monthName} September   {mon} Sep   {start} 2026-09-01   {end} 2026-09-30
// File names can also use {site}, and for downloads {ext} (e.g. .xlsx) and {original}
// (the name the site gave the file, without extension).
module.exports = {
    // Shown in messages.
    name: 'Example Site',

    // Optional. Each site gets its own Chrome profile (which also keeps its login between runs)
    // and DevTools port. Defaults: profiles/<site-id> and 9222. Give a different port only if
    // you want to run two sites at the same time.
    // browser: { profileDir: 'profiles/example', devtoolsPort: 9223, chromeArgs: [] },

    // Remove the whole login block for a public site, and set startUrl instead:
    // startUrl: 'https://example.com/reports',
    login: {
        // 'auto': fill username/password from Windows Credential Manager; you only step in for
        //         a captcha or a code. 'assisted': you do the whole login by hand.
        //         `--manual-login` on the command line forces 'assisted' for one run.
        mode: 'auto',
        url: 'https://example.com/login',
        // A page that only logged-in users stay on; reaching it means the login is done.
        loggedInUrl: 'https://example.com/home',
        // Optional: fetched to check if the saved session still works (a redirect = logged
        // out). Defaults to loggedInUrl. Set to null for sites where that check can't work.
        // sessionCheckUrl: 'https://example.com/home',

        // Name of the Generic Credential in Windows Credential Manager.
        credential: 'ReportDownloader:example',
        usernameField: '#username',
        passwordField: '#password',        // default: 'input[type=password]'
        submit: 'button[type=submit]',

        // Optional: text on the page that tells what happened after submitting.
        codeText: /verification code|one-time code/i,   // asks for a code -> you type it
        rejectedText: /incorrect|try again/i,           // login refused -> you finish by hand
        instructions: 'username, password, Sign in',    // shown when you log in by hand
    },

    // Optional: the consent banner's accept button.
    cookieAccept: 'button:has-text("Accept")',

    // Optional: navigation after login, in order. Actions: goto, click, fill (+ value),
    // select (+ value), waitFor, waitForUrl, sleep. Any step can carry a `label` for the log.
    steps: [
        { goto: 'https://example.com/reports', label: 'Opening the reports page...' },
    ],

    // The month to download: 'current' (default), 'previous' or 'YYYY-MM'. --month overrides it.
    period: 'current',

    // How the site hands over the report. Pick one type:
    report: {
        // 'download': the site has its own Download/Export button.
        type: 'download',
        steps: [   // optional: pick the month etc. before clicking
            { select: '#month', value: '{monthName} {yyyy}' },
            { click: 'button:has-text("Apply")' },
        ],
        button: 'button:has-text("Export")',
        // timeout: 60000,

        // 'table': the report is an HTML <table> on the page, saved as CSV.
        // type: 'table',
        // steps: [{ goto: 'https://example.com/reports?from={start}&to={end}' }],
        // table: 'table#report',

        // 'custom': anything else. handler is a file in this folder exporting
        //   async ({ site, browser, page, vars, outputFile }) => { ... }
        // (see sites/strava/report.js).
        // type: 'custom',
        // handler: 'report.js',
    },

    output: {
        dir: 'reports/example',                      // default: reports/<site-id>
        fileName: 'Example_{monthName}_{yyyy}{ext}', // default: {site}_{monthName}_{yyyy}{ext}
    },
};
