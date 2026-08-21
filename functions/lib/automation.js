"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loginToLMS = loginToLMS;
const playwright_1 = require("playwright");
const dates_1 = require("./dates");
const DEFAULT_LMS_URL = "https://lms.vit.ac.in/login/index.php";
async function loginToLMS(username, password, lmsUrl = DEFAULT_LMS_URL) {
    const browser = await playwright_1.chromium.launch({ headless: true });
    const page = await browser.newPage();
    const records = [];
    const assignmentsToSave = [];
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
                const url = new URL(profileLink.href);
                const id = url.searchParams.get('id');
                if (id)
                    return id;
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
                }
                else {
                    throw new Error("The dashboard did not expose an In progress filter.");
                }
            }
            else {
                throw new Error("The dashboard course filter was not found.");
            }
        }
        catch (e) {
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
                    }
                    catch (e) { }
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
        const courseLinks = await page.$$eval('a[href*="course/view.php?id="]', links => links.map(a => {
            const el = a;
            const nameEl = el.querySelector('.coursename, .multiline');
            const text = nameEl ? (nameEl.innerText.trim() || nameEl.textContent?.trim() || '') : (el.innerText.trim() || el.textContent?.trim() || el.getAttribute('title') || '');
            const href = a.href;
            let courseId = -1;
            try {
                const url = new URL(href);
                const idParam = url.searchParams.get('id');
                if (idParam)
                    courseId = parseInt(idParam, 10);
            }
            catch (e) { }
            const card = el.closest('[data-courseid], .card, .coursebox, .course-region');
            const visible = !!(card || el).getClientRects().length && getComputedStyle(card || el).visibility !== 'hidden';
            return { text, href, visible, courseId };
        }).filter(link => link.text.length > 0 && link.visible && !isNaN(link.courseId) && link.courseId > 0));
        const uniqueCourses = courseLinks.filter((v, i, a) => a.findIndex(t => (t.href === v.href && t.text === v.text)) === i);
        if (uniqueCourses.length === 0) {
            records.push({ userId, courseId: 0, content: "No courses found on the dashboard. The selectors might need adjustment based on VIT's specific theme.\n" });
            return { userId, allowlist: [], records, assignments: assignmentsToSave };
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
                const assignmentLinks = await page.$$eval('a[href*="mod/assign/view.php"]', links => links.map(a => ({
                    text: a.innerText.trim() || a.textContent?.trim() || 'Assignment',
                    href: a.href
                })).filter(link => link.text.length > 0));
                if (assignmentLinks.length > 0) {
                    const uniqueAssignments = assignmentLinks.filter((v, i, a) => a.findIndex(t => (t.href === v.href)) === i);
                    let upcomingAssignmentCount = 0;
                    for (const a of uniqueAssignments) {
                        // Navigate to assignment page to extract actual deadline
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
                                    const cells = Array.from(row.querySelectorAll('th, td'));
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
                            if (!extracted)
                                extracted = await assignPage.evaluate(() => {
                                    for (const row of Array.from(document.querySelectorAll('table tr, .submissionstatustable tr'))) {
                                        const cells = Array.from(row.querySelectorAll('th, td'));
                                        if (/due date|deadline|cut-off date/i.test(cells[0]?.innerText || ''))
                                            return cells.at(-1)?.innerText.trim() || null;
                                    }
                                    const dueElements = Array.from(document.querySelectorAll('[data-region*="due" i], .duedate, .activity-dates, .submissionstatus .status, div, p, span'));
                                    return dueElements
                                        .map(el => el.innerText.replace(/\s+/g, ' ').trim())
                                        .find(text => /^(due|due date|deadline|cut-off date)\s*:\s*.+/i.test(text) && text.length < 180)
                                        ?.replace(/^(due|due date|deadline|cut-off date)\s*:\s*/i, '') || null;
                                });
                            if (extracted)
                                deadline = extracted.replace(/\s+/g, ' ').trim();
                            await assignPage.close();
                        }
                        catch (e) {
                            console.error(`Failed to get deadline for assignment: ${a.text}`, e);
                        }
                        const deadlineDate = (0, dates_1.parseMoodleDate)(deadline);
                        if (deadlineDate) {
                            if (upcomingAssignmentCount === 0)
                                courseOutput += `Assignments:\n`;
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
                        }
                        else {
                            console.log(`Ignoring assignment without a parseable due date: ${a.text}`);
                        }
                    }
                    if (upcomingAssignmentCount === 0)
                        courseOutput += `  - No explicit assignments with a valid due date found.\n`;
                }
                else {
                    courseOutput += `  - No explicit assignments found on the main course page.\n`;
                }
            }
            catch (err) {
                courseOutput += `  - Failed to load course page.\n`;
            }
            courseOutput += `\n`;
            records.push({
                userId,
                courseId: course.courseId,
                content: courseOutput
            });
        }
        return { userId, allowlist, records, assignments: assignmentsToSave };
    }
    catch (err) {
        console.error("Scraping error:", err);
        throw err;
    }
    finally {
        await browser.close();
    }
}
//# sourceMappingURL=automation.js.map