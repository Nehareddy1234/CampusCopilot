const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function benchmark() {
  const browser = await chromium.launch({ headless: true });
  const uniqueAssignments = Array.from({ length: 10 }).map((_, i) => ({
    text: `Assignment ${i + 1}`,
    href: `file://${path.resolve(__dirname, 'mock_assignment.html')}?id=${i}`
  }));

  // Sequential approach (Original)
  let startSeq = Date.now();
  for (const a of uniqueAssignments) {
    let deadline = "Unknown deadline";
    try {
      const assignPage = await browser.newPage();
      await assignPage.goto(a.href, { waitUntil: "networkidle" });
      await assignPage.waitForSelector('table, [data-region="assignment-info"], .submissionstatustable', { timeout: 1000 }).catch(() => undefined);

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
        return { due };
      });
      deadline = assignmentStatus.due;
      await assignPage.close();
    } catch (e) {
      console.error(e);
    }
  }
  let endSeq = Date.now();
  console.log(`Sequential execution took: ${endSeq - startSeq}ms`);

  // Concurrent approach (Optimized)
  let startConc = Date.now();
  const CONCURRENCY_LIMIT = 5;
  const processAssignment = async (a) => {
    let deadline = "Unknown deadline";
    try {
      const assignPage = await browser.newPage();
      await assignPage.goto(a.href, { waitUntil: "networkidle" });
      await assignPage.waitForSelector('table, [data-region="assignment-info"], .submissionstatustable', { timeout: 1000 }).catch(() => undefined);

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
        return { due };
      });
      deadline = assignmentStatus.due;
      await assignPage.close();
    } catch (e) {
      console.error(e);
    }
    return deadline;
  };

  const results = [];
  for (let i = 0; i < uniqueAssignments.length; i += CONCURRENCY_LIMIT) {
    const chunk = uniqueAssignments.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(chunk.map(processAssignment));
    results.push(...chunkResults);
  }
  let endConc = Date.now();
  console.log(`Concurrent execution took: ${endConc - startConc}ms`);

  await browser.close();
}

benchmark();
