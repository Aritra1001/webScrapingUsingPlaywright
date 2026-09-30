const fs = require('fs');
const path = require('path');
const { STEP_ACTIONS, stepAction } = require('./steps');
const { REPORT_TYPES } = require('./reports');
const { resolveMonth } = require('./util');

const ROOT = path.join(__dirname, '..');
const SITES_DIR = path.join(ROOT, 'sites');

// Every folder under sites/ with a config.js is a site; folders starting with _ are examples.
function listSites() {
    return fs.readdirSync(SITES_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_')
            && fs.existsSync(path.join(SITES_DIR, d.name, 'config.js')))
        .map((d) => d.name);
}

// Loads sites/<id>/config.js, fills in the defaults and checks it, so a typo in a config shows
// up as a clear message before Chrome even opens. See sites/_template/config.js for every option.
function loadSite(id) {
    const dir = path.join(SITES_DIR, id);
    if (!fs.existsSync(path.join(dir, 'config.js'))) {
        throw new Error(`Unknown site "${id}". Configured sites: ${listSites().join(', ') || '(none)'}`);
    }
    const raw = require(path.join(dir, 'config.js'));

    const login = raw.login ? {
        mode: 'auto',
        passwordField: 'input[type=password]',
        sessionCheckUrl: raw.login.loggedInUrl,
        ...raw.login,
    } : null;

    const site = {
        id,
        dir,
        name: raw.name || id,
        startUrl: raw.startUrl || (login && login.url),
        browser: {
            profileDir: path.resolve(ROOT, (raw.browser && raw.browser.profileDir) || `profiles/${id}`),
            devtoolsPort: (raw.browser && raw.browser.devtoolsPort) || 9222,
            chromeArgs: (raw.browser && raw.browser.chromeArgs) || [],
        },
        login,
        cookieAccept: raw.cookieAccept || null,
        steps: raw.steps || [],
        report: raw.report,
        period: raw.period || 'current',
        output: {
            dir: path.resolve(ROOT, (raw.output && raw.output.dir) || `reports/${id}`),
            fileName: (raw.output && raw.output.fileName) || '{site}_{monthName}_{yyyy}{ext}',
        },
    };

    const errors = validate(site);
    if (errors.length) {
        throw new Error(`sites/${id}/config.js has problems:\n  - ${errors.join('\n  - ')}`);
    }
    return site;
}

function validate(site) {
    const errors = [];
    const L = site.login;

    if (L) {
        if (!L.url) errors.push('login.url is required (the login page)');
        if (!L.loggedInUrl) errors.push('login.loggedInUrl is required (a page only logged-in users stay on)');
        if (!['auto', 'assisted'].includes(L.mode)) errors.push(`login.mode must be 'auto' or 'assisted', not '${L.mode}'`);
        if (L.mode === 'auto') {
            for (const key of ['credential', 'usernameField', 'submit']) {
                if (!L[key]) errors.push(`login.${key} is required when login.mode is 'auto'`);
            }
        }
    } else if (!site.startUrl) {
        errors.push('startUrl is required for a site without a login');
    }

    const checkSteps = (steps, where) => (Array.isArray(steps) ? steps : [steps]).forEach((step, i) => {
        if (!step || typeof step !== 'object' || !stepAction(step)) {
            errors.push(`${where}[${i}] needs one of: ${STEP_ACTIONS.join(', ')}`);
        }
    });
    checkSteps(site.steps, 'steps');

    const R = site.report;
    if (!R || !REPORT_TYPES[R.type]) {
        errors.push(`report.type must be one of: ${Object.keys(REPORT_TYPES).join(', ')}`);
    } else {
        if (R.steps) checkSteps(R.steps, 'report.steps');
        if (R.type === 'download' && !R.button) errors.push('report.button is required for a download report');
        if (R.type === 'table' && !R.table) errors.push('report.table is required for a table report');
        if (R.type === 'custom' && !(R.handler && fs.existsSync(path.join(site.dir, R.handler)))) {
            errors.push(`report.handler must name a file in sites/${site.id}/`);
        }
    }

    try {
        resolveMonth(site.period);
    } catch (e) {
        errors.push(`period: ${e.message}`);
    }
    return errors;
}

module.exports = { loadSite, listSites };
