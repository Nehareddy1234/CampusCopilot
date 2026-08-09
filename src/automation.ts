import { chromium, Browser, Page } from "playwright";
import { saveAssignments, Assignment } from "./db";

const LMS_URL = "https://lms.vit.ac.in/login/index.php";

/**
 * Logs into the VIT LMS using Playwright, finds course links, and scrapes assignments.
 */
export async function loginToLMS(username: string, password: string): Promise<string> {
  const browser: Browser = await chromium.launch({ headless: true });
  const page: Page = await browser.newPage();
  
  let output = "";
  const assignmentsToSave: Assignment[] = [];

  try {
    console.log("Navigating to login page...");
    await page.goto(LMS_URL, { waitUntil: "domcontentloaded" });

    // Typical Moodle login selectors
    await page.fill('input#username, input[name="username"]', username);
    await page.fill('input#password, input[name="password"]', password);

    console.log("Clicking login...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click('button#loginbtn, button[name="loginbtn"], input[type="submit"]')
    ]);

    // Simple verification – fetch the title after login
    const title = await page.title();
    output += `Successfully logged in. Dashboard Title: ${title}\n\n`;
    console.log(`Logged in. Title: ${title}`);

    if (!page.url().includes('/my/')) {
       await page.waitForTimeout(2000);
    }

    // Moodle dashboard (block_myoverview) often loads courses asynchronously via AJAX.
    // Wait for a few seconds to ensure they have rendered.
    await page.waitForTimeout(5000);

    // Try to click the 'In progress' filter if it exists
    try {
      const dropdown = await page.$('button[data-action="course-filter"], button[data-toggle="dropdown"]');
      if (dropdown) {
         await dropdown.click();
         await page.waitForTimeout(1000);
         const inProgressOption = await page.$('[data-filter="inprogress"], [data-value="inprogress"], a:has-text("In progress")');
         if (inProgressOption) {
           await inProgressOption.click();
           console.log("Selected 'In progress' filter.");
           await page.waitForTimeout(3000); // wait for UI to update
         }
      }
    } catch (e) {
      console.log("Could not find or click 'In progress' filter, proceeding with visible courses.");
    }

    // Try to find course links
    console.log("Finding all courses (including past courses for AI context)...");
    const courseLinks = await page.$$eval('a[href*="course/view.php?id="]', links => 
      links.map(a => {
        // Extract text from the link, or from its child elements (e.g., Moodle's .multiline span), or title attribute
        const el = a as HTMLElement;
        const text = el.innerText.trim() || el.textContent?.trim() || el.getAttribute('title') || '';
        return {
          text: text,
          href: (a as HTMLAnchorElement).href
        };
      }).filter(link => link.text.length > 0)
    );

    const uniqueCourses = courseLinks.filter((v,i,a)=>a.findIndex(t=>(t.href === v.href && t.text === v.text))===i);

    if (uniqueCourses.length === 0) {
      output += "No courses found on the dashboard. The selectors might need adjustment based on VIT's specific theme.\n";
      return output;
    }

    output += `Found ${uniqueCourses.length} courses.\n\n`;

    // Go into each course and look for assignments
    for (const course of uniqueCourses) {
      output += `Course: ${course.text}\n`;
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
          output += `Assignments found:\n`;
          for (const a of uniqueAssignments) {
            output += `  - ${a.text}\n`;
            
            // Navigate to assignment page to extract actual deadline
            let deadline = "Unknown deadline";
            try {
              console.log(`Checking assignment deadline: ${a.text}`);
              const assignPage = await browser.newPage();
              await assignPage.goto(a.href, { waitUntil: "domcontentloaded" });
              
              // Look for the due date
              // First try to find a straightforward "Due: " text (common in Moodle activity headers)
              let extracted = await assignPage.evaluate(() => {
                const allDivs = Array.from(document.querySelectorAll('div, p, span'));
                for (const el of allDivs) {
                   const text = el.textContent?.trim() || '';
                   if (text.startsWith('Due:') && text.length < 100) { // arbitrary length check to avoid giant containers
                      return text.replace('Due:', '').trim();
                   }
                }
                return null;
              });

              if (extracted) {
                deadline = extracted;
              } else {
                // Fallback to the typical Moodle submission status table
                deadline = await assignPage.$$eval('table tr', rows => {
                  for (const row of rows) {
                    const htmlRow = row as HTMLElement;
                    if (htmlRow.innerText.toLowerCase().includes('due date') || htmlRow.innerText.toLowerCase().includes('deadline')) {
                      const td = htmlRow.querySelector('td.cell.c1, td:last-child');
                      return td ? (td as HTMLElement).innerText.trim() : "Unknown deadline";
                    }
                  }
                  return "Unknown deadline";
                });
              }
              await assignPage.close();
            } catch (e) {
              console.error(`Failed to get deadline for assignment: ${a.text}`, e);
            }

            output += `    Due: ${deadline}\n`;
            
            assignmentsToSave.push({
              courseName: course.text,
              title: a.text,
              deadlineString: deadline
            });
          }
        } else {
          output += `  - No explicit assignments found on the main course page.\n`;
        }
      } catch (err) {
        output += `  - Failed to load course page.\n`;
      }
      output += `\n`;
    }

    // Save to local JSON database for the reminder cron-job
    saveAssignments(assignmentsToSave);

    return output;
  } catch (err) {
    console.error("Scraping error:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
