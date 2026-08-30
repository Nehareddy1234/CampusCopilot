"use strict";
// DOM-fixture validation for faculty extraction in scrapeCourseLinks.
// Reproduces VIT-style dashboard cards where semester/period metadata
// appears before the faculty line (the reported mislabel scenario).
const { chromium } = require("playwright");
const { scrapeCourseLinks } = require("./dist/automation");

const FIXTURE = `
<html><body>
<div class="card-deck">

  <div class="card coursecard" data-courseid="101">
    <div class="card-body">
      <div class="coursename"><a href="https://lms.vit.ac.in/course/view.php?id=101">BCSE432E : Reinforcement Learning</a></div>
      <p class="text-muted">Winter Semester 2025-26</p>
      <p class="text-muted">Faculty: Dr. Kavitha S</p>
    </div>
  </div>

  <div class="card coursecard" data-courseid="102">
    <div class="card-body">
      <div class="coursename"><a href="https://lms.vit.ac.in/course/view.php?id=102">CSE4001 : Database Systems</a></div>
      <p class="text-muted">WS 2025</p>
      <p class="text-muted">MEENA KUMARI R</p>
    </div>
  </div>

  <div class="card coursecard" data-courseid="103">
    <div class="card-body">
      <div class="coursename"><a href="https://lms.vit.ac.in/course/view.php?id=103">MEE2001 : Engineering Thermodynamics</a></div>
      <p class="text-muted">Odd Semester 2025-2026</p>
      <div class="categoryname">B.Tech Mechanical</div>
    </div>
  </div>

  <div class="card coursecard" data-courseid="104">
    <div class="card-body">
      <div class="coursename"><a href="https://lms.vit.ac.in/course/view.php?id=104">HUM1001 : Engineering Ethics</a></div>
      <p class="text-muted">Fall Sem 2025</p>
      <p class="text-muted">Teacher: Prof. Arun Kumar N</p>
    </div>
  </div>

  <div class="card coursecard" data-courseid="105">
    <div class="card-body">
      <div class="coursename"><a href="https://lms.vit.ac.in/course/view.php?id=105">CHY1001 : Engineering Chemistry</a></div>
      <div class="categoryname">UG</div>
      <p class="text-muted">Dr. Senthil Kumar P</p>
    </div>
  </div>

</div>
</body></html>
`;

const EXPECTED = {
  101: "Dr. Kavitha S",
  102: "MEENA KUMARI R",
  103: "Unknown Faculty",
  104: "Prof. Arun Kumar N",
  105: "Dr. Senthil Kumar P"
};

async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(FIXTURE);

  const courses = await scrapeCourseLinks(page);
  await browser.close();

  let failures = 0;
  for (const [idStr, expected] of Object.entries(EXPECTED)) {
    const id = Number(idStr);
    const course = courses.find(c => c.courseId === id);
    if (!course) {
      console.log(`[FAIL] Course ${id}: not found in scrape results`);
      failures++;
      continue;
    }
    console.log(`[FACULTY-DEBUG] Course: "${course.text}" | Chosen: "${course.faculty}" | Candidates: ${JSON.stringify(course.facultyDebugCandidates)}`);
    if (course.faculty === expected) {
      console.log(`[PASS] Course ${id} ("${course.text}"): faculty = "${course.faculty}"`);
    } else {
      console.log(`[FAIL] Course ${id} ("${course.text}"): expected "${expected}", got "${course.faculty}"`);
      failures++;
    }
  }

  if (courses.length !== Object.keys(EXPECTED).length) {
    console.log(`[FAIL] Expected ${Object.keys(EXPECTED).length} courses, scraped ${courses.length}`);
    failures++;
  }

  console.log(failures === 0 ? "ALL FACULTY EXTRACTION CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
