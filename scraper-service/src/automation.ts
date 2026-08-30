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
  term: 'current' | 'past';
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
  isPast: boolean;
}

async function selectCourseFilter(
  page: Page,
  filterValue: 'inprogress' | 'past',
  filterLabel: string
): Promise<{ applied: boolean; errorMsg: string }> {
  try {
    // Path 1: Button / Dropdown pattern
    const dropdown = await page.$('button[data-action="course-filter"], button[data-toggle="dropdown"], [data-action="course-filter"]');
    if (dropdown) {
      await dropdown.click();
      await page.waitForTimeout(1000);
      const optionSelector = `[data-filter="${filterValue}"], [data-value="${filterValue}"], [data-action="filter"][data-filter="${filterValue}"], a:has-text("${filterLabel}"), button:has-text("${filterLabel}")`;
      const option = await page.$(optionSelector);
      if (option) {
        await option.click();
        console.log(`[FILTER-MATCH] Selected '${filterLabel}' filter via dropdown.`);
        await page.waitForTimeout(1500);
        return { applied: true, errorMsg: '' };
      }
    }

    // Path 2: Native <select> pattern
    const select = await page.$('select[data-action="course-filter"], select.custom-select, select[name="filter"]');
    if (select) {
      try {
        await select.selectOption(filterValue);
        console.log(`[FILTER-MATCH] Selected '${filterLabel}' filter via select option value.`);
        await page.waitForTimeout(1500);
        return { applied: true, errorMsg: '' };
      } catch (e) {
        try {
          await select.selectOption({ label: filterLabel });
          console.log(`[FILTER-MATCH] Selected '${filterLabel}' filter via select option label.`);
          await page.waitForTimeout(1500);
          return { applied: true, errorMsg: '' };
        } catch (e2) { }
      }
    }

    return { applied: false, errorMsg: `Could not find or apply filter for '${filterLabel}'.` };
  } catch (err) {
    return { applied: false, errorMsg: (err as Error).message || `Error selecting filter for '${filterLabel}'.` };
  }
}

async function loadAllCourses(page: Page): Promise<void> {
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
        } catch (e) { }
      }
    }

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      break; // Reached the bottom or no more courses loaded
    }
    previousHeight = newHeight;
  }
}

export async function scrapeCourseLinks(page: Page): Promise<Array<{ text: string; href: string; visible: boolean; courseId: number; faculty: string; facultyDebugCandidates: Array<{ text: string; matchedExclusion: boolean; matchedInclusion: boolean }> }>> {
  const extracted = await page.$$eval('a[href*="course/view.php?id="]', links =>
    links.map(a => {
      const el = a as HTMLElement;
      const nameEl = el.querySelector('.coursename, .multiline') as HTMLElement;
      const nameElText = nameEl ? (nameEl.innerText || nameEl.textContent || '') : '';
      const fallbackText = el.innerText || el.textContent || el.getAttribute('title') || '';
      const text = nameEl ? (nameEl.innerText.trim() || nameEl.textContent?.trim() || '') : (el.innerText.trim() || el.textContent?.trim() || el.getAttribute('title') || '');
      const href = (a as HTMLAnchorElement).href;

      let courseId = -1;
      try {
        const url = new URL(href);
        const idParam = url.searchParams.get('id');
        if (idParam) courseId = parseInt(idParam, 10);
      } catch (e) { }

      const card = el.closest('[data-courseid], .card, .coursebox, .course-region');

      let faculty = "Unknown Faculty";
      const facultyDebugCandidates: Array<{ text: string; matchedExclusion: boolean; matchedInclusion: boolean }> = [];

      if (card) {
        // Academic-period/batch/program metadata must never be chosen as a faculty name.
        const periodRegex = /semester|\bsem\b|\bterm\b|trimester|\bquarter\b|\bsession\b|\bbatch\b|\byear\b|\bodd\b|\beven\b|winter|summer|fall|spring|autumn|monsoon|\bws\b|\bss\b|\b20\d{2}\b|\b\d{4}\s*[-\u2013\u2014]\s*\d{2,4}\b|b\.?tech|m\.?tech|ph\.?d|\bug\b|\bpg\b|\bmba\b/i;
        const labelRegex = /^(teacher|teachers|instructor|faculty|course coordinator|coordinator|professor)\s*[:\-\u2013]?\s*/i;
        const titleRegex = /\b(prof|dr|mr|ms|mrs)\b\.?/i;
        // Unlabeled candidates must read like a person's name: 2-4 words,
        // letters only (no digits, codes, or metadata tokens).
        const looksLikePersonName = (value: string): boolean => {
          const words = value.split(/\s+/);
          return !/\d/.test(value) &&
            words.length >= 2 && words.length <= 4 &&
            /^[A-Za-z\u00C0-\u024F.'\- ]+$/.test(value);
        };

        const infoEls = Array.from(card.querySelectorAll('.text-muted, .teachers, .contact, .info, .categoryname, div p'));
        const seen = new Set<string>();
        const candidates: string[] = [];
        for (const info of infoEls) {
          const textContent = (info.textContent || '').replace(/\s+/g, ' ').trim();
          if (textContent && textContent.length > 3 && textContent !== text && !seen.has(textContent.toLowerCase())) {
            seen.add(textContent.toLowerCase());
            candidates.push(textContent);
          }
        }

        for (const cand of candidates) {
          const matchedExclusion = periodRegex.test(cand);
          const matchedInclusion = !matchedExclusion && (labelRegex.test(cand) || titleRegex.test(cand) || looksLikePersonName(cand));
          facultyDebugCandidates.push({
            text: cand,
            matchedExclusion,
            matchedInclusion
          });
        }

        const usable = candidates.filter(cand => !periodRegex.test(cand));

        // Priority 1: an explicitly labeled line, e.g. "Faculty: Dr. Kavitha S".
        const labeled = usable
          .map(cand => ({ cand, name: cand.replace(labelRegex, '').trim() }))
          .find(({ name }) => name.length > 2 && !/\d/.test(name));
        if (labeled) {
          faculty = labeled.name;
        } else {
          // Priority 2: a titled name (Dr./Prof./Mr./Ms./Mrs.), else an unlabeled person-like name.
          faculty = usable.find(cand => titleRegex.test(cand))
            || usable.find(looksLikePersonName)
            || "Unknown Faculty";
        }
      }

      const visible = !!(card || el).getClientRects().length && getComputedStyle(card || el).visibility !== 'hidden';
      return {
        text,
        href,
        visible,
        courseId,
        faculty,
        facultyDebugCandidates,
        debug: {
          nameElText,
          fallbackText
        }
      };
    }).filter(link => link.text.length > 0 && link.visible && !isNaN(link.courseId) && link.courseId > 0)
  );

  for (const item of extracted) {
    console.log(`[COURSENAME-DEBUG] .coursename match: "${item.debug.nameElText}" | fallback innerText: "${item.debug.fallbackText}"`);
    console.log(`[FACULTY-DEBUG] Course: "${item.text}" | Chosen: "${item.faculty}" | Candidates: ${JSON.stringify(item.facultyDebugCandidates)}`);
  }

  return extracted.map(({ text, href, visible, courseId, faculty, facultyDebugCandidates }) => ({ text, href, visible, courseId, faculty, facultyDebugCandidates }));
}

function dedupeCourseLinks<T extends { href: string; text: string }>(links: T[]): T[] {
  // Dashboard cards emit two anchors per course (cover image + course name);
  // keep one entry per href, preferring the real name over placeholder text.
  const isPlaceholder = (t: string) => /^(course image|course name)$/i.test(t.trim());
  const byHref = new Map<string, T>();
  for (const link of links) {
    const existing = byHref.get(link.href);
    if (!existing || (isPlaceholder(existing.text) && !isPlaceholder(link.text))) {
      byHref.set(link.href, link);
    }
  }
  return Array.from(byHref.values());
}

// Self-contained (no closures) so Playwright can serialize it into the page.
export function describeAssignmentLink(a: Element) {
  const el = a as HTMLElement;
  const SECTION_SEL = '.section, li.section, [data-sectionid], [data-id^="section-"], .course-section';
  const HEADER_SEL = '.sectionname, [data-for="section_title"]';
  let section = el.closest(SECTION_SEL) as HTMLElement | null;
  let header = section ? section.querySelector(`${HEADER_SEL}, h3, h4`) : null;
  if (!section) {
    // Custom themes may not wrap activities: use the nearest
    // preceding section header in document order instead.
    for (const h of Array.from(document.querySelectorAll(HEADER_SEL))) {
      if (el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING) header = h;
    }
    section = (header ? (header.closest(SECTION_SEL) || header.parentElement) : null) as HTMLElement | null;
  }
  const card = el.closest('.activity-item, li.activity, .activity, .modtype_assign') || el.parentElement;
  const cardText = ((card as HTMLElement | null)?.textContent || '').toLowerCase();
  const sectionText = ((section as HTMLElement | null)?.textContent || '').toLowerCase();
  return {
    text: el.innerText.trim() || el.textContent?.trim() || 'Assignment',
    href: (a as HTMLAnchorElement).href,
    sectionLabel: (header?.textContent || '').replace(/\s+/g, ' ').trim(),
    selfLock: /not available unless/i.test(cardText),
    sectionLock: /not available unless/i.test(sectionText)
  };
}

export async function loginToLMS(username: string, password: string, lmsUrl = DEFAULT_LMS_URL): Promise<ScrapeResult> {
  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext();
  const page: Page = await context.newPage();

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
    const inProgressFilter = await selectCourseFilter(page, 'inprogress', 'In progress');
    if (!inProgressFilter.applied) {
      throw new Error("Unable to select the LMS In progress course filter. Refusing to scrape archived courses.");
    }

    // Handle pagination/infinite scrolling to capture all course cards
    await loadAllCourses(page);

    // Try to find course links strictly extracting text from .coursename or .multiline text nodes
    console.log("Finding visible in-progress courses...");
    const courseLinks = await scrapeCourseLinks(page);

    const uniqueCourses = dedupeCourseLinks(courseLinks);

    for (const course of uniqueCourses) {
      console.log(`[FACULTY-DEBUG] Course: "${course.text}" | Chosen: "${course.faculty}" | Candidates: ${JSON.stringify(course.facultyDebugCandidates)}`);
    }

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

        // Dashboard cards may not expose teachers; fall back to the course page.
        if (course.faculty === "Unknown Faculty") {
          const pageFaculty = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('.teachers, .teacher, .contact, .coursecontacts, .course-contacts, [data-region="teachers"]'));
            const names = els
              .map(e => (e.textContent || '').replace(/\s+/g, ' ').trim())
              .filter(t => t.length > 2 && t.length < 100);
            return names[0] || null;
          });
          if (pageFaculty) {
            course.faculty = pageFaculty;
          }
          console.log(`[FACULTY-COURSEPAGE] Course: "${course.text}" | Faculty: "${pageFaculty || '(none found)'}"`);
        }

        // Look for assignments. In Moodle, assignment links usually contain "mod/assign/view.php"
        // Try selector chain against main course content region in order of preference
        const selectors = [
          '#region-main a[href*="mod/assign/view.php"]',
          '[role="main"] a[href*="mod/assign/view.php"]',
          '.course-content a[href*="mod/assign/view.php"]'
        ];

        let matchedSelector: string | null = null;
        for (const selector of selectors) {
          const count = await page.$$eval(selector, els => els.length);
          if (count > 0) {
            matchedSelector = selector;
            break;
          }
        }

        // Before count across entire page DOM for diagnostic comparison
        const totalRawCount = await page.$$eval('a[href*="mod/assign/view.php"]', els => els.length);

        const assignmentLinks = matchedSelector
          ? await page.$$eval(matchedSelector, (links, describeSrc) => {
              // Playwright serializes only this callback, so reconstruct the
              // shared descriptor from its source instead of closing over it.
              const describe = (0, eval)(`(${describeSrc})`) as typeof describeAssignmentLink;
              return (links as Element[])
                .filter(a => !(a as HTMLElement).closest('.block_calendar_upcoming, .block_timeline, [data-block="calendar_upcoming"], [data-block="timeline"], .block'))
                .map(a => describe(a))
                .filter(link => link.text.length > 0);
            }, describeAssignmentLink.toString())
          : [];

        console.log(`[SCOPE-FILTER] Course: "${course.text}" | Before: ${totalRawCount} | After: ${assignmentLinks.length}`);
        for (const link of assignmentLinks) {
          console.log(`[SECTION-DEBUG] Course: "${course.text}" | Assignment: "${link.text}" | Section: "${link.sectionLabel || '(none)'}" | SelfLock: ${link.selfLock} | SectionLock: ${link.sectionLock}`);
        }

        // A section containing a group-restricted card belongs to another
        // faculty/group; exclude all of its assignments, including unlocked
        // strays, plus any individually locked card elsewhere.
        const scopedLinks = assignmentLinks.filter(l => !l.selfLock && !l.sectionLock);
        for (const link of assignmentLinks) {
          if (link.selfLock || link.sectionLock) {
            console.log(`[SECTION-EXCLUDE] Course: "${course.text}" | Assignment: "${link.text}" | Reason: ${link.selfLock ? 'restricted to another group' : 'section belongs to another faculty/group'} | Section: "${link.sectionLabel || '(none)'}"`);
          }
        }

        if (course.faculty === "Unknown Faculty") {
          const ownSection = scopedLinks.find(l => l.sectionLabel)?.sectionLabel;
          if (ownSection) {
            course.faculty = ownSection.replace(/[_\-\s]+L\d+.*$/i, '').trim() || ownSection;
            console.log(`[FACULTY-SECTION] Course: "${course.text}" | Faculty: "${course.faculty}"`);
          }
        }

        if (scopedLinks.length > 0) {
          const uniqueAssignments = scopedLinks.filter((v, i, a) => a.findIndex(t => (t.href === v.href)) === i);
          let upcomingAssignmentCount = 0;
          let pastAssignmentCount = 0;

          const processAssignment = async (
            a: { text: string, href: string },
            expectedCourseId: number
          ): Promise<{
            a: { text: string, href: string };
            deadline: string;
            isAssignmentOpen: boolean;
            extractedSubmissionStatus: string;
            restricted: boolean;
          }> => {
            let deadline = "Unknown deadline";
            let isAssignmentOpen = false;
            let extractedSubmissionStatus = '';
            try {
              console.log(`Checking assignment deadline: ${a.text}`);
              const assignPage = await context.newPage();
              await assignPage.goto(a.href, { waitUntil: "networkidle" });

              // Verify owning course ID before processing
              const actualCourseId = await assignPage.evaluate(() => {
                // Course id 1 is Moodle's site frontpage: a login/home page artifact,
                // never a real assignment owner, so it must not count as a mismatch.
                // @ts-ignore
                if (typeof window.M !== 'undefined' && window.M.cfg && window.M.cfg.courseId) {
                  // @ts-ignore
                  const cid = Number(window.M.cfg.courseId);
                  if (!isNaN(cid) && cid > 1) return cid;
                }
                const courseLink = document.querySelector('.breadcrumb a[href*="course/view.php?id="], nav[aria-label] ol a[href*="course/view.php?id="], a[href*="course/view.php?id="]');
                if (courseLink) {
                  try {
                    const url = new URL((courseLink as HTMLAnchorElement).href);
                    const cid = Number(url.searchParams.get('id'));
                    if (!isNaN(cid) && cid > 1) return cid;
                  } catch (e) { }
                }
                return null;
              });

              if (actualCourseId !== null && actualCourseId !== expectedCourseId) {
                console.log(`[COURSE-MISMATCH] "${a.text}" belongs to course ${actualCourseId}, not the visited course ${expectedCourseId}. Excluding.`);
                await assignPage.close();
                return { a, deadline: "Unknown deadline", isAssignmentOpen: false, extractedSubmissionStatus: '', restricted: true };
              }

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
                const restrictionRegex = /this activity is currently not available|restricted access|not available until|you do not have permission|access restrictions|not a member of any group/i;
                const restrictionRegexMatched = restrictionRegex.test(pageText);
                const isRestricted = restrictionRegexMatched || (rows.length > 0 && !due && !submissionStatus);

                return {
                  due,
                  isOpen: !isClosed,
                  submissionStatus,
                  restrictionRegexMatched,
                  isRestricted,
                  rowsLength: rows.length,
                  pageTextSnippet: pageText.slice(0, 500)
                };
              });

              console.log(`[RESTRICT-DEBUG] Title: "${a.text}" | RegexMatched: ${assignmentStatus.restrictionRegexMatched} | RowsLength: ${assignmentStatus.rowsLength} | isRestricted: ${assignmentStatus.isRestricted} | PageTextSnippet: "${assignmentStatus.pageTextSnippet}"`);

              if (assignmentStatus.isRestricted) {
                console.log(`[SKIP-RESTRICTED] "${a.text}" is not assigned to this user (group/access restricted). Excluding.`);
                await assignPage.close();
                return { a, deadline, isAssignmentOpen: false, extractedSubmissionStatus: '', restricted: true };
              }

              isAssignmentOpen = assignmentStatus.isOpen;
              extractedSubmissionStatus = assignmentStatus.submissionStatus;

              let extracted = assignmentStatus.due;
              let extractionPath = extracted ? "table-primary" : "none";
              if (!extracted) {
                extracted = await assignPage.evaluate(() => {
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
                if (extracted) {
                  extractionPath = "regex-fallback";
                }
              }

              if (extracted) deadline = extracted.replace(/\s+/g, ' ').trim();
              console.log(`[DEBUG-DEADLINE] Path: "${extractionPath}" | Raw: "${extracted || ''}" | Resolved: "${deadline}"`);
              await assignPage.close();
            } catch (e) {
              console.error(`Failed to get deadline for assignment: ${a.text}`, e);
            }
            return { a, deadline, isAssignmentOpen, extractedSubmissionStatus, restricted: false };
          };

          const CONCURRENCY_LIMIT = 3;
          for (let i = 0; i < uniqueAssignments.length; i += CONCURRENCY_LIMIT) {
            const chunk = uniqueAssignments.slice(i, i + CONCURRENCY_LIMIT);
            const results = await Promise.all(chunk.map(assign => processAssignment(assign, course.courseId)));

            for (const { a, deadline, isAssignmentOpen, extractedSubmissionStatus, restricted } of results) {
              if (restricted) continue;
              const deadlineDate = parseMoodleDate(deadline);
              if (!deadlineDate) {
                console.log(`Ignoring unparseable assignment: ${a.text}`);
                continue;
              }

              console.log(`[TZ-CHECK] ISO: ${deadlineDate.toISOString()} | Local: ${deadlineDate.toString()}`);

              const past = !isUpcoming(deadlineDate);
              if (!past) {
                if (upcomingAssignmentCount === 0) courseOutput += `Upcoming Assignments:\n`;
                courseOutput += `  - ${a.text}\n`;
                courseOutput += `    Due: ${deadline}\n`;
                if (extractedSubmissionStatus) {
                  courseOutput += `    Status: ${extractedSubmissionStatus}\n`;
                }
                upcomingAssignmentCount++;
              } else {
                if (pastAssignmentCount === 0) courseOutput += `Past Assignments:\n`;
                courseOutput += `  - ${a.text}\n`;
                courseOutput += `    Was due: ${deadline}\n`;
                if (extractedSubmissionStatus) {
                  courseOutput += `    Status: ${extractedSubmissionStatus}\n`;
                }
                pastAssignmentCount++;
              }

              assignmentsToSave.push({
                userId,
                courseId: course.courseId,
                courseName: course.text,
                title: a.text,
                deadlineString: deadline,
                // ISO preserves the exact LMS date and time for reminder calculations.
                deadlineISO: deadlineDate.toISOString(),
                submissionStatus: extractedSubmissionStatus,
                isPast: past
              });
            }
          }
          if (upcomingAssignmentCount === 0 && pastAssignmentCount === 0) courseOutput += `  - No explicit assignments with a valid due date found.\n`;
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
      faculty: c.faculty,
      term: 'current' as const
    }));

    // Scrape past-semester courses (non-fatal, skip assignment scraping)
    try {
      if (!page.url().includes('/my/courses.php')) {
        await page.goto(new URL('/my/courses.php', lmsUrl).toString(), { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
      }

      const pastFilter = await selectCourseFilter(page, 'past', 'Past');
      if (pastFilter.applied) {
        await loadAllCourses(page);
        const pastCourseLinks = await scrapeCourseLinks(page);
        const uniquePastCourses = dedupeCourseLinks(pastCourseLinks);
        for (const pc of uniquePastCourses) {
          if (!finalCourses.some(existing => existing.courseId === pc.courseId || (existing.name === pc.text && existing.faculty === pc.faculty))) {
            finalCourses.push({
              courseId: pc.courseId,
              name: pc.text,
              faculty: pc.faculty,
              term: 'past'
            });
          }
        }
      } else {
        console.log(`[FILTER-SKIP] Past course filter could not be applied (${pastFilter.errorMsg}). Continuing with current courses only.`);
      }
    } catch (pastErr) {
      console.log(`[FILTER-SKIP] Failed to scrape past courses: ${(pastErr as Error).message}. Continuing with current courses only.`);
    }

    return { userId, allowlist, records, assignments: assignmentsToSave, courses: finalCourses };
  } catch (err) {
    console.error("Scraping error:", err);
    throw err;
  } finally {
    await browser.close();
  }
}
