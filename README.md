# Campus Copilot (React + Firebase Architecture)

Campus Copilot is a local web app for VIT LMS students. It uses a React frontend and a Firebase serverless backend to manage sessions, crawl the LMS for upcoming assignments, and send smart reminders.

## Architecture

- **Frontend:** React + Vite, Firebase Auth, Firestore
- **Backend:** Firebase Cloud Functions (Gen 2 / Cloud Run)
- **Scraping:** Playwright

## Setup

1. **Install Frontend Dependencies:**
   npm install

2. **Setup Environment Variables:**
   Create a .env file in the root directory and add your Firebase configuration:
   VITE_FIREBASE_API_KEY=your-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-auth-domain
   VITE_FIREBASE_PROJECT_ID=your-project-id
   VITE_FIREBASE_STORAGE_BUCKET=your-storage-bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
   VITE_FIREBASE_APP_ID=your-app-id
   VITE_ENCRYPTION_SECRET=your-secure-secret

3. **Backend Setup:**
   cd functions
   npm install

## Local Development

Run the frontend locally using the dev script.

## Deployment Notes (Cloud Run)

Standard Firebase Cloud Functions do not have the OS-level dependencies required to run Playwright (headless Chromium).
To deploy the scraper backend successfully, you must deploy the functions directory as a Docker Container to Google Cloud Run.

A Dockerfile is provided in the functions/ directory using the official Playwright base image.
