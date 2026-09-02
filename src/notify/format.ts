import { Alert, AlertType } from './types';

const SECTION_ORDER: AlertType[] = [
  'DEADLINE_APPROACHING',
  'NEW_ASSIGNMENT',
  'DEADLINE_CHANGED',
  'STATUS_CHANGED',
  'NEW_COURSE'
];

const SECTION_LABELS: Record<AlertType, string> = {
  DEADLINE_APPROACHING: 'DEADLINE SOON',
  NEW_ASSIGNMENT: 'NEW ASSIGNMENT',
  DEADLINE_CHANGED: 'DEADLINE CHANGED',
  STATUS_CHANGED: 'SUBMISSION STATUS',
  NEW_COURSE: 'NEW COURSE'
};

export function formatAlerts(alerts: Alert[]): string | null {
  if (alerts.length === 0) return null;
  const lines: string[] = [`CAMPUS COPILOT ALERTS (${alerts.length})`];
  for (const type of SECTION_ORDER) {
    const group = alerts.filter(a => a.type === type);
    if (group.length === 0) continue;
    lines.push('', SECTION_LABELS[type]);
    for (const alert of group) lines.push(`- ${alert.message}`);
  }
  return lines.join('\n');
}
