import { Alert, MonitorState, ScrapeOutput } from './types';

const HOURS_MS = 3_600_000;

const keyOf = (courseId: number, title: string) => `${courseId}::${title}`;

function hoursUntil(deadlineISO: string, now: Date): number | null {
  const timestamp = Date.parse(deadlineISO);
  if (isNaN(timestamp)) return null;
  return (timestamp - now.getTime()) / HOURS_MS;
}

function isSubmitted(status?: string): boolean {
  return /submitted|graded/i.test(status || '');
}

/**
 * Compares a fresh scrape against the previous snapshot. The first run
 * (prev === null) only baselines, so no "new assignment" flood is sent;
 * approaching-deadline warnings still fire on the first run.
 */
export function processScrape(
  prev: MonitorState | null,
  current: ScrapeOutput,
  now: Date,
  deadlineWarnHours: number
): { alerts: Alert[]; state: MonitorState } {
  const alerts: Alert[] = [];
  const isFirstRun = prev === null;
  const prevAssignments = new Map(
    (prev?.assignments ?? []).map(a => [keyOf(a.courseId, a.title), a])
  );
  const prevCourseIds = new Set((prev?.courses ?? []).map(c => c.courseId));
  const deadlineAlertKeys = new Set<string>();

  const upcoming = current.assignments.filter(a => !a.isPast);

  for (const a of upcoming) {
    const key = keyOf(a.courseId, a.title);
    const before = prevAssignments.get(key);

    if (!before) {
      if (!isFirstRun) {
        alerts.push({
          type: 'NEW_ASSIGNMENT',
          courseName: a.courseName,
          assignmentTitle: a.title,
          deadlineString: a.deadlineString,
          deadlineISO: a.deadlineISO,
          message: `${a.courseName}: ${a.title} — due ${a.deadlineString}`
        });
      }
    } else {
      if (before.deadlineISO !== a.deadlineISO) {
        alerts.push({
          type: 'DEADLINE_CHANGED',
          courseName: a.courseName,
          assignmentTitle: a.title,
          deadlineString: a.deadlineString,
          deadlineISO: a.deadlineISO,
          message: `${a.courseName}: ${a.title} — now due ${a.deadlineString}`
        });
      }
      if (a.submissionStatus && a.submissionStatus !== before.submissionStatus) {
        alerts.push({
          type: 'STATUS_CHANGED',
          courseName: a.courseName,
          assignmentTitle: a.title,
          message: `${a.courseName}: ${a.title} — ${a.submissionStatus}`
        });
      }
    }

    // A deadline change re-arms the approaching-deadline warning.
    const alreadyWarned = before ? before.deadlineISO === a.deadlineISO && before.deadlineAlertSent : false;
    const hours = hoursUntil(a.deadlineISO, now);
    if (
      hours !== null && hours > 0 && hours <= deadlineWarnHours &&
      !isSubmitted(a.submissionStatus) && !alreadyWarned
    ) {
      alerts.push({
        type: 'DEADLINE_APPROACHING',
        courseName: a.courseName,
        assignmentTitle: a.title,
        deadlineString: a.deadlineString,
        deadlineISO: a.deadlineISO,
        message: `${a.courseName}: ${a.title} — due in ~${Math.max(1, Math.round(hours))}h (${a.deadlineString})`
      });
      deadlineAlertKeys.add(key);
    }
  }

  if (!isFirstRun) {
    for (const c of current.courses) {
      if (c.term === 'current' && !prevCourseIds.has(c.courseId)) {
        alerts.push({ type: 'NEW_COURSE', courseName: c.name, message: c.name });
      }
    }
  }

  const state: MonitorState = {
    version: 1,
    lastRunAt: now.toISOString(),
    userId: current.userId ?? null,
    assignments: upcoming.map(a => {
      const key = keyOf(a.courseId, a.title);
      const before = prevAssignments.get(key);
      const deadlineUnchanged = !!before && before.deadlineISO === a.deadlineISO;
      return {
        courseId: a.courseId,
        courseName: a.courseName,
        title: a.title,
        deadlineString: a.deadlineString,
        deadlineISO: a.deadlineISO,
        submissionStatus: a.submissionStatus,
        deadlineAlertSent: deadlineAlertKeys.has(key) || (deadlineUnchanged ? before!.deadlineAlertSent : false)
      };
    }),
    courses: current.courses
      .filter(c => c.term === 'current')
      .map(c => ({ courseId: c.courseId, name: c.name, term: c.term }))
  };

  return { alerts, state };
}
