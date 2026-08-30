# Campus Copilot Knowledge Base

## Purpose

Campus Copilot is a local student-assistant web application for VIT Moodle users. It signs in to an LMS with Playwright, identifies current courses and assignment due dates, then presents an AI-generated daily digest, chat support, and in-browser deadline reminders.

## Architecture at a glance

```text
Browser (index.html)
  | POST /login: LMS credentials and LMS URL
  v
Express server (src/server.ts)
  | calls
  v
Playwright scraper (src/automation.ts) ---> VIT Moodle
  |
  +--> OpenRouter via OpenAI SDK (src/ai.ts) ---> daily digest
  |
  v
Browser localStorage: session, assignments, course data, chat, reminder settings

Browser chat --> POST /chat --> OpenRouter via OpenAI SDK --> Browser chat history
```

There is no database and the server deliberately does not persist LMS credentials, assignments, chat history, or API keys to disk.

## Main components

| Location | Responsibility |
| --- | --- |
| `index.html` | Single-page UI, login form, local session state, chat display, browser notifications, and reminder cadence. |
| `src/server.ts` | Express server, static-file hosting, validation, per-IP rate limiting, and the `/login` and `/chat` routes. |
| `src/automation.ts` | Moodle login, course-filter selection, course and assignment scraping, due-date extraction, and course classification. |
| `src/ai.ts` | Daily-digest prompt and OpenRouter request. |
| `src/dates.ts` | Moodle-date parsing, future-deadline checks, and India-time formatting. |
| `run_benchmark.js` | Experimental deadline-extraction comparison utility. |
| `test_moodle.js` | Manual Playwright login/scraping experiment; not an automated test suite. |

## User flows

### Login and scraping

1. The user enters an HTTPS LMS URL, username, and password in the browser.
2. The browser posts those values to `/login`.
3. The server validates the URL and credentials' types, then calls `loginToLMS`.
4. Playwright signs in, opens `/my/courses.php`, explicitly applies Moodle's **In progress** filter, loads all available course cards, and collects course links.
5. For each current course, the scraper visits assignment links and reads the assignment-status table. It excludes restricted activities and assignments without a parseable due date.
6. The server sends the scraped records, assignments, courses, and a generated digest back to the browser.
7. The browser saves that response in `localStorage` under `campus-copilot-state`.

The scraper then attempts a non-fatal **Past** filter pass. Past courses are recorded for reference but are not scanned for assignments.

### Chat

1. The browser submits the message, scraped records, current user ID, and up to the current chat history to `/chat`.
2. The server filters records to the active user, retains at most ten valid history messages, and asks OpenRouter's `openai/gpt-4o-mini` for a concise academic response.
3. The browser appends and saves the user message and reply.

### Reminders

The browser checks local assignment data once per minute while the page is open. It can show a browser notification for the nearest future assignment no more frequently than the selected cadence (1, 6, 12, or 24 hours). This is not a background service: reminders stop when the page/browser is closed.

## Data model

### Scraped records

```ts
interface ScrapedRecord {
  userId: string | number;
  courseId: number;
  content: string; // human-readable course and assignment summary
}
```

### Assignments

```ts
interface Assignment {
  userId: string | number;
  courseId: number;
  courseName: string;
  title: string;
  deadlineString: string; // LMS-provided display value
  deadlineISO: string;    // parsed value used for sorting/reminders
  submissionStatus?: string;
  isPast: boolean;
}
```

### Courses

```ts
interface CourseData {
  courseId: number;
  name: string;
  faculty: string;
  term: 'current' | 'past';
}
```

## API reference

### `POST /login`

Request:

```json
{ "username": "…", "password": "…", "lmsUrl": "https://lms.vit.ac.in/login/index.php" }
```

Successful response contains `success`, `digest`, `records`, `userId`, `allowlist`, `assignments`, and `courses`.

Failure responses use `400` for invalid input, `429` for rate limiting, and `502` for LMS or digest-generation failures.

### `POST /chat`

Request:

```json
{ "message": "What is due next?", "records": [], "userId": 123, "history": [], "courses": [] }
```

`message`, `records`, and `userId` are required. The server accepts an optional `courses` array, separating `current` and `past` courses before building the AI prompt.

## Configuration and running locally

Requirements:

- Node.js 18+
- Playwright Chromium: `npx playwright install chromium`
- An OpenRouter API key in the server environment as `OPENROUTER_API_KEY`

Commands:

```bash
npm install
npm run dev
# or
npm run build
npm start
```

The default port is `3000`; set `PORT` to override it.

## Security and privacy behavior

- LMS URL input must use HTTPS.
- `/login` and `/chat` share an in-memory per-IP limit of 10 requests per minute.
- JSON request bodies are capped at 250 KB.
- LMS credentials are forwarded only for the active scraping request and are not saved by the server.
- User session data, including scraped records and chat history, remains in that browser's `localStorage` until logout.
- The browser's optional **API URL** field changes the target backend URL; it does not configure the OpenRouter credential.

## Maintenance guide

### Moodle UI changes

If the scraper no longer finds courses or assignments, inspect and update selectors in `src/automation.ts`:

- Course filter controls: `selectCourseFilter`
- Course cards and names: `scrapeCourseLinks`
- Assignment links: `a[href*="mod/assign/view.php"]`
- Assignment status table and due-date fallback: `processAssignment`

Keep the explicit **In progress** filter requirement. It prevents archived courses from being treated as active coursework.

### AI behavior

- Daily digest wording and selection guidance live in `src/ai.ts`.
- Chat rules and current/past-course policy live in the `/chat` system prompt in `src/server.ts`.
- Both use `openai/gpt-4o-mini` through OpenRouter's OpenAI-compatible endpoint.

### Time and reminders

`parseMoodleDate` currently relies on JavaScript `Date.parse`. If Moodle emits locale-specific or ambiguous dates, add explicit parsing and tests in `src/dates.ts`. `deadlineISO` is the source of truth for deadline sorting and reminder checks.

## Current limitations and follow-up opportunities

1. `node-cron` is installed but no cron scheduler or database implementation exists in the current source tree. Reminders are implemented in `index.html`, not server-side.
2. The frontend does not currently include `courses` in its `/chat` request, so the backend's detailed current-versus-past course prompt context receives an empty list. Pass `courses: state.courses` in that request to enable it.
3. The README says users enter their own OpenRouter key in the login screen, but the current UI has no API-key field and the backend reads `OPENROUTER_API_KEY` from its environment. Documentation should follow the implementation unless the UI is changed.
4. `npm test` is a placeholder. Add unit tests for date parsing and request validation, plus mocked Playwright fixtures for Moodle selector changes.
5. `Date.parse` uses the runtime's parsing behavior and may not reliably interpret every Moodle date format or timezone.
6. The server enables unrestricted CORS. Tighten the allowed origin list before exposing it beyond a trusted local setup.

## Troubleshooting

| Symptom | Likely cause | First check |
| --- | --- | --- |
| Login returns 502 | Invalid LMS credentials, unreachable LMS, changed login page, or Playwright browser missing | Confirm credentials/URL and run `npx playwright install chromium`. |
| No current courses | Moodle filter/card selectors changed or no courses match In progress | Review browser automation logs and `selectCourseFilter` / `scrapeCourseLinks`. |
| Assignments missing | Activity is restricted, closed, lacks a parseable date, or Moodle table markup changed | Inspect the assignment-status table and extraction logs. |
| Digest/chat provider error | Missing or invalid `OPENROUTER_API_KEY`, or provider balance/error | Check the server environment and OpenRouter account. |
| No notification | Browser permission denied, page is closed, or cadence has not elapsed | Allow notifications and keep the application open. |
