const fs = require('fs');
const path = require('path');
const { log } = require('./log');
const { fillFileName, toCsv } = require('./util');
const { runSteps } = require('./steps');

// How a site hands over its report, chosen by report.type in the site config.
const REPORT_TYPES = {
    // The site has its own Download / Export button: click it and keep the file it sends.
    async download(site, { page, vars }) {
        const R = site.report;
        await runSteps(page, R.steps || [], vars);
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: R.timeout || 60000 }),
            page.locator(R.button).first().click(),
        ]);
        const original = download.suggestedFilename();
        const file = outputFile(site, { ...vars, ext: path.extname(original), original: path.parse(original).name });
        await download.saveAs(file);
        log(`Downloaded ${original} -> ${file}`);
    },

    // The report is an HTML <table> on the page: read it and save it as CSV.
    async table(site, { page, vars }) {
        const R = site.report;
        await runSteps(page, R.steps || [], vars);
        const table = page.locator(R.table).first();
        await table.waitFor({ state: 'visible', timeout: R.timeout || 60000 });
        const rows = await table.evaluate((el) => [...el.rows]
            .map((row) => [...row.cells].map((cell) => cell.innerText.trim())));
        const file = outputFile(site, { ...vars, ext: '.csv' });
        fs.writeFileSync(file, toCsv(rows));
        log(`Saved ${Math.max(rows.length - 1, 0)} rows -> ${file}`);
    },

    // Anything else: the site's own module (report.handler) does the work.
    async custom(site, context) {
        const handler = require(path.join(site.dir, site.report.handler));
        await handler({ site, ...context, outputFile: (vars) => outputFile(site, vars) });
    },
};

// Full path for a report, built from output.fileName, e.g. '{monthName}_{yyyy}{ext}'.
function outputFile(site, vars) {
    fs.mkdirSync(site.output.dir, { recursive: true });
    return path.join(site.output.dir, fillFileName(site.output.fileName, { site: site.id, ...vars }));
}

const runReport = (site, context) => REPORT_TYPES[site.report.type](site, context);

module.exports = { runReport, REPORT_TYPES };
