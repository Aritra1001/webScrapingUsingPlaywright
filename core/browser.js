const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log } = require('./log');
const { sleep } = require('./util');

const CHROME_PATHS = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
].filter(Boolean);

const devtools = (site) => `http://127.0.0.1:${site.browser.devtoolsPort}`;

// Sites such as Strava guard their login with reCAPTCHA Enterprise, which rejects logins made
// in Playwright's own browser (it reports navigator.webdriver = true). So every run uses the
// installed Chrome, which Playwright attaches to over the DevTools port.
function launchChrome(site, url) {
    const chromePath = CHROME_PATHS.find((p) => fs.existsSync(p));
    if (!chromePath) {
        log('Google Chrome not found. Set CHROME_PATH to chrome.exe and retry.');
        process.exit(1);
    }

    // Chrome only allows remote debugging on a non-default profile. Each site gets its own,
    // which also keeps that site's login between runs.
    return spawn(chromePath, [
        `--remote-debugging-port=${site.browser.devtoolsPort}`,
        `--user-data-dir=${site.browser.profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        ...site.browser.chromeArgs,
        url,
    ], { stdio: 'ignore' });
}

// Lists Chrome's open tabs over the DevTools HTTP endpoint without attaching to any of them.
async function listTabs(site) {
    const tabs = await fetch(`${devtools(site)}/json/list`).then((r) => r.json()).catch(() => []);
    return tabs.filter((t) => t.type === 'page');
}

// Retries while Chrome is still starting up. Returns null if it never answers.
async function attach(site, tries = 30) {
    for (let i = 0; i < tries; i++) {
        const browser = await chromium.connectOverCDP(devtools(site)).catch(() => null);
        if (browser) return browser;
        await sleep(1000);
    }
    return null;
}

async function findPage(context, urlPrefix, tries = 30) {
    for (let i = 0; i < tries; i++) {
        const page = context.pages().find((p) => p.url().startsWith(urlPrefix));
        if (page) return page;
        await sleep(1000);
    }
    return null;
}

// Asks Chrome to shut down normally. Killing the process instead would lose cookies Chrome
// hasn't flushed to disk yet — including a login made moments ago — so the next run would
// have to log in again.
async function closeChrome(browser, chrome) {
    if (browser && browser.isConnected()) {
        // chrome may already have exited if it only handed the URL to a Chrome that was open.
        const exited = chrome.exitCode !== null ? Promise.resolve()
            : new Promise((resolve) => chrome.once('exit', resolve));
        const cdp = await browser.newBrowserCDPSession().catch(() => null);
        if (cdp) {
            await cdp.send('Browser.close').catch(() => {});
            await Promise.race([exited, sleep(10000)]);
        }
    }
    chrome.kill(); // no-op once Chrome has exited
}

// Consent banners are optional: once accepted, the choice is stored in the profile.
async function acceptCookies(page, selector) {
    if (!selector) return;
    try {
        const accept = page.locator(selector).first();
        await accept.waitFor({ state: 'visible', timeout: 5000 });
        await accept.click();
        log('Accepted the cookie consent banner.');
    } catch {
        // Not shown this time (consent already stored).
    }
}

module.exports = { launchChrome, listTabs, attach, findPage, acceptCookies, closeChrome };
