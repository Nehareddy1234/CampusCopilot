"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMoodleDate = parseMoodleDate;
exports.isUpcoming = isUpcoming;
exports.formatDeadline = formatDeadline;
function parseMoodleDate(value) {
    const cleaned = value.replace(/^\s*(due date|due|deadline)\s*:?\s*/i, "").replace(/\s+/g, " ").trim();
    if (!cleaned || /^(no due date|not set|unknown deadline)$/i.test(cleaned))
        return null;
    const time = Date.parse(cleaned);
    return Number.isNaN(time) ? null : new Date(time);
}
function isUpcoming(date, now = new Date()) {
    return date.getTime() > now.getTime();
}
function formatDeadline(date) {
    return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata'
    }).format(date);
}
//# sourceMappingURL=dates.js.map