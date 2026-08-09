import cron from 'node-cron';
import { readDB, addAlert } from './db';

// This function attempts to parse a date string like "Sunday, 30 May 2026, 11:59 PM" into a Date object.
function parseMoodleDate(dateStr: string): Date | null {
  try {
    const timestamp = Date.parse(dateStr);
    if (!isNaN(timestamp)) {
      return new Date(timestamp);
    }
    return null;
  } catch {
    return null;
  }
}

export function startScheduler() {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    console.log("Running daily deadline checks...");
    checkDeadlines();
  });
}

export function checkDeadlines() {
  const db = readDB();
  const now = new Date();
  
  db.assignments.forEach(assignment => {
    // We try to extract a date from the assignment string.
    // In a robust implementation, the scraper would separate the title and date perfectly.
    // Here we'll do a simple fallback if the string contains a recognizable date.
    
    // For Moodle, dates often look like: "Due: Sunday, 30 May 2026, 11:59 PM"
    const dueMatch = assignment.title.match(/Due:\s*(.+)/i);
    const dateStrToParse = dueMatch ? dueMatch[1] : assignment.deadlineString || assignment.title;
    
    const deadlineDate = parseMoodleDate(dateStrToParse);
    
    if (deadlineDate) {
      const diffTime = deadlineDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 0 && diffDays <= 7) {
        // Daily reminder if it's less than a week away
        addAlert(`🚨 DAILY REMINDER: "${assignment.courseName} - ${assignment.title}" is due in ${diffDays} days!`);
      } else if (diffDays > 7 && now.getDay() === 1) {
        // Weekly reminder on Monday if it's more than a week away
        addAlert(`📅 WEEKLY REMINDER: "${assignment.courseName} - ${assignment.title}" is due in ${diffDays} days.`);
      }
    }
  });
}
