"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_1 = require("playwright");
async function run() {
    const browser = await playwright_1.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        await page.goto('https://lms.vit.ac.in/login/index.php');
        console.log(await page.title());
        // Use test credentials to try to login and verify the extract userId script. Wait, I don't have credentials!
        // It's okay, I have implemented standard extraction using fallback strategies.
    }
    catch (e) {
        console.error(e);
    }
    await browser.close();
}
run();
