"use strict";
// DOM-fixture validation for describeAssignmentLink section-lock scoping:
// assignments in a section that contains a group-restricted card (another
// faculty's section) must be flagged, including unlocked strays like Lab 8.
const { chromium } = require("playwright");
const { describeAssignmentLink } = require("./dist/automation");

const WITH_SECTIONS = `
<html><body><div id="region-main"><ul class="course-content">
  <li class="section" data-sectionid="1"><div class="content">
    <h3 class="sectionname">Dr. G. Bharadwaja Kumar_L29+L30_Reinforcement Learning_Lab</h3>
    <ul>
      <li class="activity modtype_assign"><div class="activity-item"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=11">LAB-1 Epsilon Greedy</a></div></li>
      <li class="activity modtype_assign"><div class="activity-item"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=16">LAB-6 SARSA implementation</a></div></li>
    </ul>
  </div></li>
  <li class="section" data-sectionid="2"><div class="content">
    <h3 class="sectionname">D JEYA MALA_L15+L16_Reinforcement Learning_Lab</h3>
    <ul>
      <li class="activity modtype_assign"><div class="activity-item"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=17">Lab 7 - DQN &amp; Double DQN Implementation</a><div class="availabilityinfo">Not available unless: You belong to D JEYA MALA(L15+L16)</div></div></li>
      <li class="activity modtype_assign"><div class="activity-item"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=18">Lab 8 - REINFORCE with baseline</a></div></li>
      <li class="activity modtype_assign"><div class="activity-item"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=19">Lab 9 - Actor Critic Algorithms</a><div class="availabilityinfo">Not available unless: You belong to D JEYA MALA(L15+L16)</div></div></li>
    </ul>
  </div></li>
</ul></div></body></html>
`;

const FLAT_THEME = `
<html><body><div id="region-main">
  <div class="grp">
    <h3 class="sectionname">OWN SECTION</h3>
    <div class="acts"><a href="https://lms.vit.ac.in/mod/assign/view.php?id=11">LAB-1 Epsilon Greedy</a></div>
  </div>
  <div class="grp">
    <h3 class="sectionname">OTHER SECTION</h3>
    <div class="acts">
      <a href="https://lms.vit.ac.in/mod/assign/view.php?id=17">Lab 7</a><div class="availabilityinfo">Not available unless: You belong to X</div>
      <a href="https://lms.vit.ac.in/mod/assign/view.php?id=18">Lab 8 - REINFORCE with baseline</a>
    </div>
  </div>
</div></body></html>
`;

async function describeAll(page) {
  const src = describeAssignmentLink.toString();
  return page.$$eval('#region-main a[href*="mod/assign/view.php"]', (links, s) => {
    const describe = (0, eval)(`(${s})`);
    return links.map(a => describe(a));
  }, src);
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  let failures = 0;
  const check = (label, actual, expected) => {
    if (actual === expected) {
      console.log(`[PASS] ${label}`);
    } else {
      console.log(`[FAIL] ${label}: expected ${expected}, got ${actual}`);
      failures++;
    }
  };

  await page.setContent(WITH_SECTIONS);
  const withSections = await describeAll(page);
  const byId = Object.fromEntries(withSections.map(l => [new URL(l.href).searchParams.get("id"), l]));

  check("LAB-1 sectionLabel", byId["11"].sectionLabel.includes("Bharadwaja"), true);
  check("LAB-1 selfLock", byId["11"].selfLock, false);
  check("LAB-1 sectionLock", byId["11"].sectionLock, false);
  check("LAB-6 sectionLock", byId["16"].sectionLock, false);
  check("Lab 7 selfLock", byId["17"].selfLock, true);
  check("Lab 8 selfLock", byId["18"].selfLock, false);
  check("Lab 8 sectionLock (unlocked stray in foreign section)", byId["18"].sectionLock, true);
  check("Lab 8 sectionLabel", byId["18"].sectionLabel.includes("JEYA MALA"), true);
  check("Lab 9 selfLock", byId["19"].selfLock, true);

  await page.setContent(FLAT_THEME);
  const flat = await describeAll(page);
  const flatById = Object.fromEntries(flat.map(l => [new URL(l.href).searchParams.get("id"), l]));
  check("flat: LAB-1 sectionLock (fallback path)", flatById["11"].sectionLock, false);
  check("flat: LAB-1 sectionLabel (fallback path)", flatById["11"].sectionLabel, "OWN SECTION");
  check("flat: Lab 8 sectionLock (fallback path)", flatById["18"].sectionLock, true);

  await browser.close();
  console.log(failures === 0 ? "ALL SECTION-LOCK CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
