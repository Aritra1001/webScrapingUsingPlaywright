// Strava: monthly activity reports for members of the GainInsights club.
// Run with: node download-report.js --site strava
module.exports = {
    name: 'Strava',

    login: {
        mode: 'auto',
        url: 'https://www.strava.com/login',
        loggedInUrl: 'https://www.strava.com/dashboard',
        credential: 'ReportDownloader:strava',
        // Strava renders a desktop and a mobile copy of the form (#desktop-email / #mobile-email)
        // depending on the window width, so match whichever one is visible.
        // "Remember me" is ticked by default, so it is left alone.
        usernameField: 'input[name=email]:visible',
        submit: 'button[id$=-login-button]:visible',
        codeText: /sent you a code|verification code|enter (the|your) code/i,
        rejectedText: /unexpected error occurred/i,
        instructions: 'email, Log In, the emailed code, Next',
    },

    cookieAccept: 'button:has-text("Accept All")',

    steps: [
        { goto: 'https://www.strava.com/dashboard', label: 'Opening the dashboard...' },
        { goto: 'https://www.strava.com/clubs/GainInsights', label: 'Opening the club page...' },
        { goto: 'https://www.strava.com/clubs/976969/members', label: 'Opening the members list...' },
    ],

    // Strava has no export: the month's activities are read from the athlete's chart, and you
    // pick members (and months) by hand, so `period` doesn't apply here.
    report: { type: 'custom', handler: 'report.js' },

    output: {
        dir: 'reports/strava',
        fileName: '{athlete}_{monthName}_{yyyy}.csv',
    },
};
