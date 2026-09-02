export interface AssignmentSnapshot {
  courseId: number;
  courseName: string;
  title: string;
  deadlineString: string;
  deadlineISO: string;
  submissionStatus?: string;
  deadlineAlertSent: boolean;
}

export interface CourseSnapshot {
  courseId: number;
  name: string;
  term: 'current' | 'past';
}

export interface MonitorState {
  version: 1;
  lastRunAt: string;
  userId: string | number | null;
  assignments: AssignmentSnapshot[];
  courses: CourseSnapshot[];
}

export type AlertType =
  | 'NEW_ASSIGNMENT'
  | 'DEADLINE_CHANGED'
  | 'DEADLINE_APPROACHING'
  | 'STATUS_CHANGED'
  | 'NEW_COURSE';

export interface Alert {
  type: AlertType;
  courseName: string;
  assignmentTitle?: string;
  deadlineString?: string;
  deadlineISO?: string;
  message: string;
}

// Structural mirror of the scraper-service output fields the monitor consumes.
export interface ScrapeAssignment {
  userId: string | number;
  courseId: number;
  courseName: string;
  title: string;
  deadlineString: string;
  deadlineISO: string;
  submissionStatus?: string;
  isPast: boolean;
}

export interface ScrapeCourse {
  courseId: number;
  name: string;
  faculty: string;
  term: 'current' | 'past';
}

export interface ScrapeOutput {
  userId: string | number;
  assignments: ScrapeAssignment[];
  courses: ScrapeCourse[];
}
