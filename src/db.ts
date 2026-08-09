import fs from 'fs';
import path from 'path';

const DB_FILE = path.join(__dirname, '..', 'database.json');

export interface Assignment {
  courseName: string;
  title: string;
  deadlineString: string;
}

export interface Alert {
  id: string;
  message: string;
  timestamp: string;
}

export interface DB {
  assignments: Assignment[];
  alerts: Alert[];
}

const defaultDB: DB = { assignments: [], alerts: [] };

export function readDB(): DB {
  if (!fs.existsSync(DB_FILE)) {
    writeDB(defaultDB);
    return defaultDB;
  }
  const data = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    return JSON.parse(data);
  } catch {
    return defaultDB;
  }
}

export function writeDB(db: DB) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function saveAssignments(assignments: Assignment[]) {
  const db = readDB();
  db.assignments = assignments;
  writeDB(db);
}

export function addAlert(message: string) {
  const db = readDB();
  db.alerts.unshift({
    id: Math.random().toString(36).substring(7),
    message,
    timestamp: new Date().toISOString()
  });
  // Keep only the last 50 alerts
  if (db.alerts.length > 50) db.alerts = db.alerts.slice(0, 50);
  writeDB(db);
}
