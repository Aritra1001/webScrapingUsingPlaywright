const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// 'current' | 'previous' | 'YYYY-MM'  ->  'YYYY-MM'
function resolveMonth(value, today = new Date()) {
    const ym = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (value === 'current') return ym(today);
    if (value === 'previous') return ym(new Date(today.getFullYear(), today.getMonth() - 1, 1));

    const match = /^(\d{4})-(\d{2})$/.exec(String(value));
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return value;
    throw new Error(`Invalid month "${value}" — use current, previous or YYYY-MM (e.g. 2026-08).`);
}

// Values that URLs, form inputs and file names in a site config can refer to as {name}.
// '2026-09' -> { month: '2026-09', yyyy: '2026', mm: '09', yyyymm: '202609',
//               monthName: 'September', mon: 'Sep', start: '2026-09-01', end: '2026-09-30' }
function periodVars(month) {
    const [yyyy, mm] = month.split('-');
    const lastDay = new Date(Number(yyyy), Number(mm), 0).getDate();
    const monthName = MONTH_NAMES[Number(mm) - 1];
    return {
        month, yyyy, mm,
        yyyymm: `${yyyy}${mm}`,
        monthName,
        mon: monthName.slice(0, 3),
        start: `${month}-01`,
        end: `${month}-${String(lastDay).padStart(2, '0')}`,
    };
}

// 'report?from={start}&to={end}' -> 'report?from=2026-09-01&to=2026-09-30'.
// Unknown {names} are left as they are.
function fillTemplate(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

// Like fillTemplate, but every value is made file-name safe ("Jane D." -> "Jane_D").
// {ext} is kept as is, dot included.
function fillFileName(template, vars) {
    const safe = {};
    for (const [key, value] of Object.entries(vars)) {
        safe[key] = key === 'ext' ? value
            : String(value == null ? '' : value).replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_|_$/g, '');
    }
    return fillTemplate(template, safe);
}

// [['Name', 'Value'], ['a', 1]] -> CSV text, every cell quoted.
function toCsv(rows) {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    return rows.map((row) => row.map(esc).join(',')).join('\n') + '\n';
}

module.exports = { sleep, MONTH_NAMES, resolveMonth, periodVars, fillTemplate, fillFileName, toCsv };
