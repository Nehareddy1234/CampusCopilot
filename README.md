# Campus Copilot — LMS Scraper Microservice ??

A high-performance, headless Chromium scraping microservice powered by **Playwright** and **Express.js**, designed to interface with the VIT Student LMS portal.

This repository serves as the remote scraping engine for **[Campus Notifier](https://github.com/Nehareddy1234/campus-notifier)**.

---

## ??? Architecture

```
+---------------------------------+
¦     campus-notifier (Brain)     ¦
¦  - Supabase Database            ¦
¦  - Multi-user Cron Scheduler    ¦
¦  - Email Alert Dispatch (SMTP)  ¦
+---------------------------------+
                 ¦ POST /scrape
                 ?
+---------------------------------+
¦  campus-copilot (Scraper Worker)¦
¦  - Express.js Microservice      ¦
¦  - Playwright Headless Chromium ¦
¦  - Deployed on Render           ¦
+---------------------------------+
                 ¦ HTTPS Login & Scraping
                 ?
+---------------------------------+
¦       VIT LMS Portal            ¦
+---------------------------------+
```

---

## ?? Features

- **Headless Browser Automation**: Navigates VIT LMS, authenticates, and extracts enrolled courses and assignments.
- **Microservice API**: Exposes lightweight endpoints for health checks and scraping tasks.
- **Security & Authorization**: Protected with internal API key authentication (`INTERNAL_API_KEY`).
- **Render Ready**: Optimized for zero-cost hosting on Render Web Services with health check endpoints.

---

## ??? API Endpoints

### 1. Health Check
`GET /health`
- Returns `200 OK` when the service is active and responsive.
- Used by GitHub Actions workflows and monitors to warm up the service.

### 2. Scrape LMS Data
`POST /scrape`
- **Headers:**
  - `x-internal-api-key`: `<INTERNAL_API_KEY>`
  - `Content-Type`: `application/json`
- **Body:**
  ```json
  {
    "username": "STUDENT_REG_NO",
    "password": "STUDENT_LMS_PASSWORD"
  }
  ```
- **Response:**
  ```json
  {
    "courses": [...],
    "assignments": [...]
  }
  ```

---

## ?? Local Development

```bash
cd scraper-service
npm install
npm run dev
```

Server starts on `http://localhost:10000`.

---

## ?? Related Repositories

- **[campus-notifier](https://github.com/Nehareddy1234/campus-notifier)**: Main multi-user notification system, signup portal, and cron dispatcher.
