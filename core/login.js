const { log } = require('./log');
const { sleep } = require('./util');
const { readCredential } = require('./credentials');
const { listTabs, attach, findPage, acceptCookies } = require('./browser');

// Attaches to the Chrome that was just launched on the login page, fills in what it can from
// the stored credential, then detaches again so nothing is attached while you solve a captcha
// or type an emailed code. Returns true when it has already told you what to do next.
async function autoLogin(site) {
    const L = site.login;
    const cred = readCredential(L.credential);
    if (!cred || !cred.username) {
        log(`No credential "${L.credential}" in Windows Credential Manager — log in by hand.`);
        log('  (Add it as a Generic Credential to let the script fill the login in next time.)');
        return false;
    }

    const browser = await attach(site);
    if (!browser) {
        log('Could not attach to Chrome for the automatic login — log in by hand.');
        return false;
    }

    try {
        const page = await findPage(browser.contexts()[0], new URL(L.url).origin);
        if (!page) throw new Error(`the ${site.name} tab did not open`);
        await page.waitForLoadState('domcontentloaded');
        await acceptCookies(page, site.cookieAccept);

        // A saved session skips the login entirely. Asking the server is the reliable check:
        // an expired session can leave its remember-me cookies behind.
        if (L.sessionCheckUrl) {
            const loggedIn = await page.evaluate((url) => fetch(url, { redirect: 'manual' })
                .then((r) => r.ok && r.type !== 'opaqueredirect'), L.sessionCheckUrl).catch(() => false);
            if (loggedIn) {
                log('Already logged in (saved session).');
                await page.goto(L.loggedInUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                return true;
            }
        }

        log(`Filling in the login as ${cred.username} (from Credential Manager)...`);
        await page.locator(L.usernameField).first().fill(cred.username, { timeout: 30000 });
        let passwordFilled = false;
        if (L.passwordField && cred.password
            && await page.locator(L.passwordField).first().isVisible().catch(() => false)) {
            // Username and password on the same form.
            await page.locator(L.passwordField).first().fill(cred.password);
            passwordFilled = true;
        }
        await page.locator(L.submit).first().click();

        // Wait for whatever the site shows next.
        let outcome = 'unknown';
        for (let i = 0; i < 30 && outcome === 'unknown'; i++) {
            await sleep(500);
            if (page.url().startsWith(L.loggedInUrl)) {
                outcome = 'loggedIn';
                break;
            }
            const text = await page.locator('body').innerText().catch(() => '');
            if (L.rejectedText && L.rejectedText.test(text)) outcome = 'rejected';
            else if (L.codeText && L.codeText.test(text)) outcome = 'code';
            else if (!passwordFilled && L.passwordField
                && await page.locator(L.passwordField).first().isVisible().catch(() => false)) {
                // Password on a second screen, after the username.
                if (!cred.password) {
                    outcome = 'password';
                } else {
                    await page.locator(L.passwordField).first().fill(cred.password);
                    await page.locator(L.passwordField).first().press('Enter');
                    passwordFilled = true;
                }
            }
        }

        if (outcome === 'loggedIn') {
            log('Logged in automatically.');
            return true;
        }

        await page.bringToFront().catch(() => {});
        process.stdout.write('\x07'); // terminal bell
        if (outcome === 'rejected') {
            log(`>>> ${site.name} rejected the automatic login. Please finish it by hand in the Chrome window. <<<`);
        } else if (outcome === 'code') {
            log(`>>> ${site.name} is asking for a code — type it into the Chrome window. <<<`);
        } else if (outcome === 'password') {
            log(`>>> ${site.name} wants a password, but the credential has none — type it in the Chrome window. <<<`);
        } else {
            log('>>> Please finish the login in the Chrome window (captcha / code). <<<');
        }
        log('    Waiting until you are logged in - no timeout.');
        return true;
    } catch (e) {
        log(`Automatic login stopped (${e.message.split('\n')[0]}) — please finish logging in by hand.`);
        return false;
    } finally {
        // Detaches only: Chrome and its tabs stay open.
        await browser.close().catch(() => {});
    }
}

// Polls Chrome's tab list (without attaching) until a tab sits on the logged-in page. A tab
// still loading that page can report its URL briefly before being bounced back to the login,
// so it must be seen on two polls in a row. No timeout.
async function waitForLogin(site, prompted = false) {
    const L = site.login;
    let seen = 0;
    for (let tick = 1; ; tick++) {
        await sleep(2000);
        const tabs = await listTabs(site);

        seen = tabs.some((t) => t.url.startsWith(L.loggedInUrl)) ? seen + 1 : 0;
        if (seen >= 2) return;

        if (!prompted && tabs.some((t) => t.url.startsWith(L.url))) {
            log(`>>> Log in manually in the Chrome window${L.instructions ? ` (${L.instructions})` : ''}. <<<`);
            prompted = true;
        }
        if (tick % 15 === 0) log('  ...waiting for you to finish logging in');
    }
}

module.exports = { autoLogin, waitForLogin };
