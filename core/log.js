const fs = require('fs');
const path = require('path');

let logFile = null;

// Starts a fresh log file for this run; everything logged is also printed to the terminal.
function logTo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    logFile = file;
}

function log(message) {
    console.log(message);
    if (logFile) fs.appendFileSync(logFile, `${message}\n`);
}

module.exports = { log, logTo };
