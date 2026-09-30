const { log } = require('./log');
const { sleep, fillTemplate } = require('./util');

// Navigation steps a site config can list, run in order after login. Every string may use the
// period placeholders ({yyyy}, {mm}, {monthName}, {start}, {end}, ...), e.g.
//   { goto: 'https://example.com/reports?month={yyyy}-{mm}' }
//   { click: 'text=Monthly' }
//   { fill: '#from', value: '{start}' }
//   { select: '#month', value: '{monthName} {yyyy}' }
//   { waitFor: '#report-table' }
//   { waitForUrl: 'https://example.com/reports/ready' }
//   { sleep: 2000 }
// Any step can also carry a `label` that is logged instead of the raw action.
const ACTIONS = {
    goto: (page, s, v) => page.goto(fillTemplate(s.goto, v), { waitUntil: 'domcontentloaded' }),
    click: (page, s, v) => page.locator(fillTemplate(s.click, v)).first().click(),
    fill: (page, s, v) => page.locator(fillTemplate(s.fill, v)).first().fill(fillTemplate(s.value, v)),
    select: (page, s, v) => page.locator(fillTemplate(s.select, v)).first().selectOption(fillTemplate(s.value, v)),
    waitFor: (page, s, v) => page.locator(fillTemplate(s.waitFor, v)).first().waitFor({ state: 'visible' }),
    waitForUrl: (page, s, v) => page.waitForURL((url) => url.href.startsWith(fillTemplate(s.waitForUrl, v))),
    sleep: (page, s) => sleep(s.sleep),
};

const STEP_ACTIONS = Object.keys(ACTIONS);

const stepAction = (step) => STEP_ACTIONS.find((action) => action in step);

async function runSteps(page, steps, vars) {
    for (const step of steps) {
        const action = stepAction(step);
        log(`  ${step.label || `${action} ${fillTemplate(step[action], vars)}`}`);
        await ACTIONS[action](page, step, vars);
    }
}

module.exports = { runSteps, stepAction, STEP_ACTIONS };
