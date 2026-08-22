import { chromium, Browser, Page } from "playwright";
import { isUpcoming, parseMoodleDate } from "./dates";

const DEFAULT_LMS_URL = "https://lms.vit.ac.in/login/index.php";

/**
 * Logs into the VIT LMS using Playwright, finds course links, and scrapes assignments.
 */
export interface ScrapedRecord {
  userId: string | number;
  courseId: number;
  content: string;
}

export interface CourseData {
  courseId: number;
  name: string;
  faculty: string;
}

export interface ScrapeResult {
  userId: string | number;
  allowlist: number[];
  records: ScrapedRecord[];
  assignments: Assignment[];
  courses: CourseData[];
}

export interface Assignment {
  userId: string | number;
  courseId: number;
  courseName: string;
  title: string;
  deadlineString: string;
  deadlineISO: string;
  submissionStatus?: string;
}

export async function loginToLMS(username: string, password: string, lmsUrl = DEFAULT_LMS_URL): Promise<ScrapeResult> {
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();
  
  const records: ScrapedRecord[] = [];
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
    console.log(`Logged in. Title: ${title}`);

    if (!page.url().includes('/my/courses.php')) {
       await page.goto(new URL('/my/courses.php', lmsUrl).toString(), { waitUntil: "domcontentloaded" });
    }

    // Extract user ID using Moodle's global config or profile links
    const userId = await page.evaluate(() => {
      // @ts-ignore
      if (typeof window.M !== 'undefined' && window.M.cfg && window.M.cfg.userid) {
        // @ts-ignore
        return window.M.cfg.userid;
      }
      const profileLink = document.querySelector('a[href*="user/profile.php?id="], a[href*="user/view.php?id="]');
      if (profileLink) {
        const url = new URL((profileLink as HTMLAnchorElement).href);
        const id = url.searchParams.get('id');
        if (id) return id;
      }
      return 'unknown_user';
    });

    console.log(`Extracted userId: ${userId}`);

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

    // Handle pagination/infinite scrolling to capture all course cards
    console.log("Loading all courses...");
    let previousHeight = 0;
    while (true) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);

      const loadMoreBtn = await page.$('button[data-action="more-courses"], .loadmore, button:has-text("Show more")');
      if (loadMoreBtn) {
        const isVisible = await loadMoreBtn.isVisible();
        if (isVisible) {
          try {
            await loadMoreBtn.click();
            await page.waitForTimeout(1500);
          } catch (e) {}
        }
      }

      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === previousHeight) {
        break; // Reached the bottom or no more courses loaded
      }
      previousHeight = newHeight;
    }

    // Try to find course links strictly extracting text from .coursename or .multiline text nodes
    console.log("Finding visible in-progress courses...");
    const courseLinks = await page.$$eval('a[href*="course/view.php?id="]', links =>
      links.map(a => {
        const el = a as HTMLElement;
        const nameEl = el.querySelector('.coursename, .multiline') as HTMLElement;
        const text = nameEl ? (nameEl.innerText.trim() || nameEl.textContent?.trim() || '') : (el.innerText.trim() || el.textContent?.trim() || el.getAttribute('title') || '');
        const href = (a as HTMLAnchorElement).href;

        let courseId = -1;
        try {
          const url = new URL(href);
          const idParam = url.searchParams.get('id');
          if (idParam) courseId = parseInt(idParam, 10);
        } catch (e) {}

        const card = el.closest('[data-courseid], .card, .coursebox, .course-region');

        let faculty = "Unknown Faculty";
        if (card) {
           const infoEls = Array.from(card.querySelectorAll('.text-muted, .teachers, .contact, .info, .categoryname, div p'));
           for (const info of infoEls) {
              const textContent = (info.textContent || '').trim();
              if (textContent && textContent.length > 3 && textContent !== text) {
                 if (/(teacher|instructor|faculty|prof\.|dr\.)/i.test(textContent) || textContent.split(/\s+/).length <= 4) {
                     faculty = textContent.replace(/(teacher|instructor|faculty):\s*/i, '').trim();
                     break;
                 }
              }
           }
        }

        const visible = !!(card || el).getClientRects().length && getComputedStyle(card || el).visibility !== 'hidden';
        return { text, href, visible, courseId, faculty };
      }).filter(link => link.text.length > 0 && link.visible && !isNaN(link.courseId) && link.courseId > 0)
    );

    const uniqueCourses = courseLinks.filter((v,i,a)=>a.findIndex(t=>(t.href === v.href && t.text === v.text))===i);

    if (uniqueCourses.length === 0) {
      records.push({ userId, courseId: 0, content: "No courses found on the dashboard. The selectors might need adjustment based on VIT's specific theme.\n" });
      return { userId, allowlist: [], records, assignments: assignmentsToSave, courses: [] };
    }

    const allowlist = uniqueCourses.map(c => c.courseId);
    records.push({ userId, courseId: 0, content: `Found ${uniqueCourses.length} courses.\n\n` });

    // Go into each course and look for assignments
    for (const course of uniqueCourses) {
      // Allowlist Enforcement: only process courses in the allowlist
      if (!allowlist.includes(course.courseId)) {
        console.log(`Course ${course.text} (${course.courseId}) is not in allowlist. Skipping.`);
        continue;
      }

      let courseOutput = `Active course: ${course.text}\n`;
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

          const processAssignment = async (a: {text: string, href: string}) => {
            let deadline = "Unknown deadline";
            let isAssignmentOpen = false;
            let extractedSubmissionStatus = '';
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

                return { due, isOpen: !isClosed, submissionStatus };
              });
              isAssignmentOpen = assignmentStatus.isOpen;
              extractedSubmissionStatus = assignmentStatus.submissionStatus;

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
            return { a, deadline, isAssignmentOpen, extractedSubmissionStatus };
          };

          const CONCURRENCY_LIMIT = 3;
          for (let i = 0; i < uniqueAssignments.length; i += CONCURRENCY_LIMIT) {
            const chunk = uniqueAssignments.slice(i, i + CONCURRENCY_LIMIT);
            const results = await Promise.all(chunk.map(processAssignment));

            for (const { a, deadline, isAssignmentOpen, extractedSubmissionStatus } of results) {
              const deadlineDate = parseMoodleDate(deadline);
              if (deadlineDate) {
                if (upcomingAssignmentCount === 0) courseOutput += `Assignments:\n`;
                courseOutput += `  - ${a.text}\n`;
                courseOutput += `    Due: ${deadline}\n`;
                if (extractedSubmissionStatus) {
                  courseOutput += `    Status: ${extractedSubmissionStatus}\n`;
                }
                upcomingAssignmentCount++;
                assignmentsToSave.push({
                  userId,
                  courseId: course.courseId,
                  courseName: course.text,
                  title: a.text,
                  deadlineString: deadline,
                  // ISO preserves the exact LMS date and time for reminder calculations.
                  deadlineISO: deadlineDate.toISOString(),
                  submissionStatus: extractedSubmissionStatus
                });
              } else {
                console.log(`Ignoring assignment without a parseable due date: ${a.text}`);
              }
            }
          }
          if (upcomingAssignmentCount === 0) courseOutput += `  - No explicit assignments with a valid due date found.\n`;
        } else {
          courseOutput += `  - No explicit assignments found on the main course page.\n`;
        }
      } catch (err) {
        courseOutput += `  - Failed to load course page.\n`;
      }
      courseOutput += `\n`;

      records.push({
        userId,
        courseId: course.courseId,
        content: courseOutput
      });
    }

    const finalCourses: CourseData[] = uniqueCourses.map(c => ({
      courseId: c.courseId,
      name: c.text,
      faculty: c.faculty
    }));

    return { userId, allowlist, records, assignments: assignmentsToSave, courses: finalCourses };
  } catch (err) {
    console.error("Scraping error:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
