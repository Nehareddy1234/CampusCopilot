# Campus Copilot

Campus Copilot is a local web app for VIT LMS students. It signs in to the LMS, uses browser automation to collect active courses and upcoming assignment deadlines, then provides an AI-generated daily digest, a course chat assistant, and deadline reminders.

## What it uses

- **Node.js + TypeScript** for the application
- **Express** to serve the web interface and API
- **Playwright** to sign in to VIT LMS and scrape course/assignment data
- **OpenRouter / OpenAI SDK** (`openai/gpt-4o-mini`) for daily digests and chat
- **node-cron** for daily deadline checks and reminders
- **marked** to render AI-generated Markdown in the browser
- Browser `localStorage` to store the user's API key, scraped assignment data, reminders, and chat history

The scraper deliberately selects the LMS **In progress** course filter and retains only assignments with a verified future deadline.

## Prerequisites

- Node.js 18 or later
- Playwright Chromium browser files

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install the Playwright browser used for LMS automation:

   ```bash
   npx playwright install chromium
   ```

3. Start the app and enter your own OpenRouter API key in the login screen. No server-side API key or external database is required.

## Run locally

For development (recommended — starts both the main app and the scraper microservice concurrently):

```bash
npm run dev:all
```

> **Note:** Running `npm run dev` alone only starts the main Express application. Without the scraper microservice running simultaneously on port 10000, login requests will fail with a 502 Bad Gateway / ECONNREFUSED error.

Or build and run the compiled app:

```bash
npm run build
npm start
```

On Windows systems where PowerShell blocks `npm.ps1`, use `npm.cmd` instead:

```powershell
npm.cmd run dev:all
```

Open [http://localhost:3000](http://localhost:3000), enter your VIT LMS credentials, and wait for the dashboard digest to load.

## How it works

1. The app logs into VIT LMS through Playwright.
2. It applies Moodle's **In progress** course filter.
3. It visits those courses and reads assignment due dates from Moodle's submission-status table.
4. Only assignments with future, parseable due dates are returned to the browser.
5. The browser stores the course data locally and uses it for the digest, chat, and on-screen reminders.

## Privacy and security

- LMS credentials are used only for the current login request and are not stored by the app.
- Your API key is stored in this browser's local storage at your request and is sent only to the local Campus Copilot server to make OpenRouter requests. Do not use a shared computer.
- Use **Clear local data** in the app to remove the saved API key, assignments, reminders, and chat history.
- Local reminders are displayed while the app is open. Browser local storage cannot deliver background notifications after the browser is closed.
- The server applies request-size validation, request throttling, and never writes user course data or API keys to disk.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:all` | **Recommended:** Run both the main Express app and scraper microservice concurrently. |
| `npm run dev` | Run the main TypeScript server alone (login will fail without the scraper running). |
| `npm run build` | Compile TypeScript into `dist/`. |
| `npm start` | Run the compiled server. |
