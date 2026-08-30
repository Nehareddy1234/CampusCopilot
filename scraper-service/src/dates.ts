export function parseMoodleDate(value: string): Date | null {
  const cleaned = value.replace(/^\s*(due date|due|deadline)\s*:?\s*/i, "").replace(/\s+/g, " ").trim();
  if (!cleaned || /^(no due date|not set|unknown deadline)$/i.test(cleaned)) return null;
  const time = Date.parse(cleaned);
  return Number.isNaN(time) ? null : new Date(time);
}

export function isUpcoming(date: Date, now = new Date()): boolean {
  return date.getTime() > now.getTime();
}

export function formatDeadline(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata'
  }).format(date);
}
