import { chromium, Browser, Page } from "playwright";
import { isUpcoming, parseMoodleDate } from "./dates";

const DEFAULT_LMS_URL = "https://lms.vit.ac.in/login/index.php";

/**
 * Logs into the VIT LMS using Playwright, finds course links, and scrapes assignments.
 */
export interface ScrapeResult {
  context: string;
  assignments: Assignment[];
}

export interface Assignment {
  courseName: string;
  title: string;
  deadlineString: string;
  deadlineISO: string;
}

export async function loginToLMS(username: string, password: string, lmsUrl = DEFAULT_LMS_URL): Promise<ScrapeResult> {
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();
  
  let output = "";
  const assignmentsToSave: Assignment[] = [];

  try {
    console.log("Navigating to login page...");
    await page.goto(lmsUrl, { waitUntil: "domcontentloaded" });

    // Typical Moodle login selectors
    await page.fill('input#username, input[name="username"]', username);
    await page.fill('input#password, input[name="password"]', password);

    console.log("Clicking login...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click('button#loginbtn, button[name="loginbtn"], input[type="submit"]')
    ]);

    // Simple verification – fetch the title after login
    const loginErrors = await page.locator('.loginerrors, .alert-danger, [role="alert"]').allTextContents();
    if (page.url().includes('/login/') || loginErrors.some(text => /invalid|incorrect|error/i.test(text))) {
      throw new Error('LMS login failed. Check the website address, username, and password.');
    }

    const title = await page.title();
    output += `Successfully logged in. Dashboard Title: ${title}\n\n`;
    console.log(`Logged in. Title: ${title}`);

    if (!page.url().includes('/my/')) {
       await page.waitForTimeout(2000);
    }

    // Moodle dashboard (block_myoverview) often loads courses asynchronously via AJAX.
    // Wait for a few seconds to ensure they have rendered.
    await page.waitForTimeout(5000);

    // The dashboard includes archived cards by default. We require the explicit
    // In progress filter instead of silently scraping every visible course.
    try {
      const dropdown = await page.$('button[data-action="course-filter"], button[data-toggle="dropdown"]');
      if (dropdown) {
         await dropdown.click();
         await page.waitForTimeout(1000);
         const inProgressOption = await page.$('[data-filter="inprogress"], [data-value="inprogress"], [data-action="filter"][data-filter="inprogress"], a:has-text("In progress")');
         if (inProgressOption) {
           await inProgressOption.click();
           console.log("Selected 'In progress' filter.");
           await page.waitForTimeout(1500);
         } else {
           throw new Error("The dashboard did not expose an In progress filter.");
         }
      } else {
        throw new Error("The dashboard course filter was not found.");
      }
    } catch (e) {
      throw new Error("Unable to select the LMS In progress course filter. Refusing to scrape archived courses.");
    }

    // Try to find course links
    console.log("Finding visible in-progress courses...");
    const courseLinks = await page.$$eval('[data-region="courses-view"] a[href*="course/view.php?id="], #block-region-content a[href*="course/view.php?id="]', links =>
      links.map(a => {
        const el = a as HTMLElement;
        const text = el.innerText.trim() || el.textContent?.trim() || el.getAttribute('title') || '';
        const card = el.closest('[data-courseid], .card, .coursebox');
        const visible = !!(card || el).getClientRects().length && getComputedStyle(card || el).visibility !== 'hidden';
        return { text, href: (a as HTMLAnchorElement).href, visible };
      }).filter(link => link.text.length > 0 && link.visible)
    );

    const uniqueCourses = courseLinks.filter((v,i,a)=>a.findIndex(t=>(t.href === v.href && t.text === v.text))===i);

    if (uniqueCourses.length === 0) {
      output += "No courses found on the dashboard. The selectors might need adjustment based on VIT's specific theme.\n";
      return { context: output, assignments: assignmentsToSave };
    }

    output += `Found ${uniqueCourses.length} courses.\n\n`;

    // Go into each course and look for assignments
    for (const course of uniqueCourses) {
      output += `Active course: ${course.text}\n`;
      console.log(`Visiting course: ${course.text}`);
      
      try {
        await page.goto(course.href, { waitUntil: "domcontentloaded" });
        
        // Look for assignments. In Moodle, assignment links usually contain "mod/assign/view.php"
        const assignmentLinks = await page.$$eval('a[href*="mod/assign/view.php"]', links => 
          links.map(a => ({
            text: (a as HTMLElement).innerText.trim() || (a as HTMLElement).textContent?.trim() || 'Assignment',
            href: (a as HTMLAnchorElement).href
          })).filter(link => link.text.length > 0)
        );

        if (assignmentLinks.length > 0) {
          const uniqueAssignments = assignmentLinks.filter((v,i,a)=>a.findIndex(t=>(t.href === v.href))===i);
          let upcomingAssignmentCount = 0;
          for (const a of uniqueAssignments) {
            // Navigate to assignment page to extract actual deadline
            let deadline = "Unknown deadline";
            let isAssignmentOpen = false;
            try {
              console.log(`Checking assignment deadline: ${a.text}`);
              const assignPage = await browser.newPage();
              await assignPage.goto(a.href, { waitUntil: "networkidle" });
              await assignPage.waitForSelector('table, [data-region="assignment-info"], .submissionstatustable', { timeout: 5000 }).catch(() => undefined);
              
              // Moodle's submission table is authoritative. The fallback only
              // accepts short leaf nodes, avoiding dates mixed in from containers.
              const assignmentStatus = await assignPage.evaluate(() => {
                const rows = Array.from(document.querySelectorAll('table tr, .submissionstatustable tr'));
                const fields = rows.map(row => {
                  const cells = Array.from(row.querySelectorAll('th, td')) as HTMLElement[];
                  return {
                    label: (cells[0]?.innerText || '').replace(/\s+/g, ' ').trim(),
                    value: (cells.at(-1)?.innerText || '').replace(/\s+/g, ' ').trim()
                  };
                });

                const due = fields.find(field => /due date|deadline|cut-off date/i.test(field.label))?.value || null;
                const submissionStatus = fields.find(field => /submission status/i.test(field.label))?.value || '';
                const pageText = document.body.innerText.replace(/\s+/g, ' ').toLowerCase();
                const isClosed = /\b(closed|not available|submission closed|submitted for grading)\b/i.test(submissionStatus)
                  || /this assignment is not currently available|submissions are closed/i.test(pageText);

                return { due, isOpen: !isClosed };
              });
              isAssignmentOpen = assignmentStatus.isOpen;

              let extracted = assignmentStatus.due;
              if (!extracted) extracted = await assignPage.evaluate(() => {
                for (const row of Array.from(document.querySelectorAll('table tr, .submissionstatustable tr'))) {
                  const cells = Array.from(row.querySelectorAll('th, td')) as HTMLElement[];
                  if (/due date|deadline|cut-off date/i.test(cells[0]?.innerText || '')) return cells.at(-1)?.innerText.trim() || null;
                }
                const dueElements = Array.from(document.querySelectorAll(
                  '[data-region*="due" i], .duedate, .activity-dates, .submissionstatus .status, div, p, span'
                )) as HTMLElement[];
                return dueElements
                  .map(el => el.innerText.replace(/\s+/g, ' ').trim())
                  .find(text => /^(due|due date|deadline|cut-off date)\s*:\s*.+/i.test(text) && text.length < 180)
                  ?.replace(/^(due|due date|deadline|cut-off date)\s*:\s*/i, '') || null;
              });

              if (extracted) deadline = extracted.replace(/\s+/g, ' ').trim();
              await assignPage.close();
            } catch (e) {
              console.error(`Failed to get deadline for assignment: ${a.text}`, e);
            }

            const deadlineDate = parseMoodleDate(deadline);
            if (isAssignmentOpen && deadlineDate && isUpcoming(deadlineDate)) {
              if (upcomingAssignmentCount === 0) output += `Upcoming assignments:\n`;
              output += `  - ${a.text}\n`;
              output += `    Due: ${deadline}\n`;
              upcomingAssignmentCount++;
              assignmentsToSave.push({
                courseName: course.text,
                title: a.text,
                deadlineString: deadline,
                // ISO preserves the exact LMS date and time for reminder calculations.
                deadlineISO: deadlineDate.toISOString()
              });
            } else {
              console.log(`Ignoring closed assignment or assignment without a future due date: ${a.text}`);
            }
          }
          if (upcomingAssignmentCount === 0) output += `  - No open assignments with a future due date.\n`;
        } else {
          output += `  - No explicit assignments found on the main course page.\n`;
        }
      } catch (err) {
        output += `  - Failed to load course page.\n`;
      }
      output += `\n`;
    }

    return { context: output, assignments: assignmentsToSave };
  } catch (err) {
    console.error("Scraping error:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
