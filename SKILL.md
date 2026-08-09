---
name: campus-copilot
description: An automated agent skill for logging into the VIT LMS, scraping course and assignment data, and generating AI-powered daily digests and reminders.
---

# Campus Copilot Skill

This skill provides instructions on how to use, maintain, and extend the **Campus Copilot** project. The copilot is a Node.js/TypeScript application that utilizes Playwright for web automation and OpenRouter (OpenAI SDK) for AI summaries.

## Core Capabilities

1. **LMS Scraping:** Uses Playwright to headlessly log into `https://lms.vit.ac.in`, navigate the dashboard, and extract active courses and assignments.
2. **AI Digest & Chat:** Uses OpenRouter to process the raw scraped data into a readable daily digest, and serves as an interactive chatbot allowing users to ask questions about their coursework.
3. **Automated Reminders:** Uses `node-cron` to check a local JSON database daily and generates UI alerts for upcoming deadlines.

## Project Structure

- `src/server.ts`: The Express backend that serves the UI and handles the `/login` and `/chat` API routes.
- `src/automation.ts`: The Playwright script responsible for the actual DOM navigation and data extraction from Moodle.
- `src/ai.ts`: The OpenRouter integration containing the prompt logic for the Daily Digest.
- `src/scheduler.ts` & `src/db.ts`: The background cron-job and local JSON database handlers for tracking deadlines over time without needing to re-scrape constantly.
- `public/index.html`: The frontend chat interface.

## Setup & Execution

### Prerequisites
- Node.js (v18+)
- Playwright browsers installed (`npx playwright install`)
- An OpenRouter API key stored in a `.env` file at the project root (`OPENROUTER_API_KEY=sk-or-...`)

### Running the Copilot
1. Navigate to the project directory: `cd campus-copilot`
2. Start the development server: `npm run dev`
3. Open a browser and navigate to `http://localhost:3000`
4. Enter the LMS credentials to trigger the scraping and initialization process.

## Customization Guidelines for Agents

When a user requests modifications to Campus Copilot, follow these guidelines:

- **Adjusting Selectors:** If the VIT LMS theme changes and scraping fails, modify the `page.$$eval` CSS selectors inside `src/automation.ts`. Look specifically for Moodle classes like `.coursebox` or links containing `mod/assign/view.php`.
- **Changing AI Prompts:** To alter the tone or structure of the Daily Digest, modify the `systemPrompt` variable in `src/ai.ts`.
- **Modifying Reminder Rules:** To change how often reminders trigger (e.g., changing weekly to 3-days out), adjust the date-math logic inside the `checkDeadlines()` function in `src/scheduler.ts`.
- **Adding Delivery Methods:** If the user wants email reminders instead of UI alerts, add `nodemailer` to `src/scheduler.ts` and update the `addAlert()` function to dispatch an email.