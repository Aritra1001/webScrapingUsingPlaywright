const { log } = require('./log');

// Reads a Generic credential (Control Panel -> Credential Manager -> Windows Credentials) by
// the name it was saved under, e.g. "ReportDownloader:strava". The password never reaches the
// log or any file.
function readCredential(name) {
    try {
        const { findCredentials } = require('@napi-rs/keyring');
        // (service, target): on Windows the lookup is by target, the exact name shown in
        // Credential Manager. The service argument is required but unused there.
        const [cred] = findCredentials('ReportDownloader', name);
        return cred ? { username: cred.account, password: cred.password || '' } : null;
    } catch (e) {
        log(`Could not read Windows Credential Manager: ${e.message}`);
        return null;
    }
}

module.exports = { readCredential };
