# Campus Copilot — LMS Scraper Microservice 

A high-performance, headless Chromium scraping microservice powered by **Playwright** and **Express.js**, designed to interface with the VIT Student LMS portal.

This repository serves as the remote scraping engine for **[Campus Notifier](https://github.com/Nehareddy1234/campus-notifier)**.

- **Live Render Scraper Endpoint**: [`https://campus-copilot-scraper.onrender.com`](https://campus-copilot-scraper.onrender.com)
- **Health Check**: [`https://campus-copilot-scraper.onrender.com/health`](https://campus-copilot-scraper.onrender.com/health)

---

## Architecture & Data Flow

```
+-------------------------------------------------------------------------+
|                  CAMPUS NOTIFIER (Orchestration Engine)                 |
|                                                                         |
|  1. Student registers on Web Portal -> Password encrypted with AES-256 |
|  2. Encrypted profile stored securely in Supabase Database              |
|  3. GitHub Actions cron runs every 4 hours                              |
|  4. Pre-warms Render -> Decrypts password in memory -> Calls /scrape    |
+------------------------------------+------------------------------------+
                                     |
                          POST /scrape (HTTPS)
                          Headers: x-internal-api-key
                                     |
                                     v
+-------------------------------------------------------------------------+
|                 CAMPUS COPILOT (Scraper Microservice)                   |
|                      Hosted on Render Web Service                       |
|                                                                         |
|  1. Validates Shared Secret API Key (`INTERNAL_API_KEY`)                |
|  2. Launches Headless Chromium via Playwright                          |
|  3. Logs into VIT LMS using student credentials                         |
|  4. Parses courses, announcements, deadlines, & assignments             |
|  5. Returns structured JSON payload to Campus Notifier                  |
+------------------------------------+------------------------------------+
                                     |
                         Returns Courses & Deadlines JSON
                                     |
                                     v
+-------------------------------------------------------------------------+
|                      NOTIFICATION DISPATCH (SMTP)                       |
|                                                                         |
|  1. Calculates assignment diffs & upcoming 24h deadlines                |
|  2. Formats modern responsive HTML email alerts                         |
|  3. Dispatches instant email notification to student                    |
+-------------------------------------------------------------------------+
```

---

## Security & Credential Handling

Student credential security is built with zero-plaintext exposure:

1. **AES-256-GCM Encryption**:
   - Student LMS passwords are never stored in plaintext.
   - When a student registers via the web portal, their password is encrypted using authenticated **AES-256-GCM** with a 64-character master hex key (`CREDENTIAL_KEY`) and a unique initialization vector (IV) per entry.
2. **Ephemeral In-Memory Handling**:
   - Passwords are only decrypted in-memory during the active scrape execution inside GitHub Actions / local runtime.
   - The scraper receives credentials over TLS/HTTPS, authenticates with VIT LMS, extracts course data, and immediately drops the session from memory.
3. **API Key Authorization**:
   - All scraping routes (`POST /scrape`) are protected with an `x-internal-api-key` header to prevent unauthorized access.
4. **Isolated Zero-Cost Infrastructure**:
   - The scraper runs in an isolated container on Render, while user records and snapshots reside in Supabase.

---

## API Endpoints

### 1. Health Check
`GET /health`
- **URL**: `https://campus-copilot-scraper.onrender.com/health`
- **Purpose**: Verifies that the service is running and awake. Used by GitHub Actions to warm up Render from sleep.
- **Sample Response**:
  ```json
  {
    "status": "ok",
    "service": "campus-copilot-scraper",
    "timestamp": "2026-09-09T08:12:00.000Z"
  }
  ```

### 2. Scrape LMS Data
`POST /scrape`
- **URL**: `https://campus-copilot-scraper.onrender.com/scrape`
- **Headers**:
  - `x-internal-api-key`: `<INTERNAL_API_KEY>`
  - `Content-Type`: `application/json`
- **Body**:
  ```json
  {
    "username": "STUDENT_REG_NO",
    "password": "STUDENT_LMS_PASSWORD"
  }
  ```
- **Response**:
  ```json
  {
    "courses": [
      {
        "courseCode": "CSE2001",
        "courseTitle": "Computer Architecture",
        "assignments": [
          {
            "title": "Digital Assignment 1",
            "dueDate": "2026-09-15T23:59:00.000Z",
            "status": "Due"
          }
        ]
      }
    ]
  }
  ```

---

## Local Development

```bash
# Navigate to scraper directory
cd scraper-service

# Install dependencies & Playwright browsers
npm install
npx playwright install chromium

# Start the development server
npm run dev
```

The scraper will be running on `http://localhost:10000`.

---

## Related Repositories

- **[campus-notifier](https://github.com/Nehareddy1234/campus-notifier)**: Main multi-user notification engine, student registration web portal, Supabase integration, and cron dispatcher.