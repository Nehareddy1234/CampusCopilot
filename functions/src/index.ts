import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { loginToLMS } from './automation';
import { decrypt, encrypt } from './encryption';

admin.initializeApp();
const db = getFirestore();

export const scheduledMoodleSync = onSchedule("every 24 hours", async (event) => {
  console.log("Starting scheduled Moodle sync...");
  try {
    const usersSnapshot = await db.collection("users").where("isActive", "==", true).get();

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      console.log(`Syncing for user ${doc.id}`);

      try {
        const result = await loginToLMS(
          userData.username,
          decrypt(userData.password), // Decrypt credentials securely
          decrypt(userData.lmsUrl) || "https://lms.vit.ac.in/login/index.php"
        );

        // Update assignments in Firestore
        for (const assignment of result.assignments) {
          // Use a deterministic ID based on title and course to prevent duplicates
          const assignmentId = Buffer.from(`${assignment.courseId}-${assignment.title}`).toString('base64').replace(/[/+=]/g, '');

          await db.collection("users").doc(doc.id).collection("assignments").doc(assignmentId).set({
            ...assignment,
            updatedAt: FieldValue.serverTimestamp(),
            createdDate: FieldValue.serverTimestamp() // Assuming it's new for the reminder calculations
          }, { merge: true });
        }

        // Update course sync timestamp
        for (const courseId of result.allowlist) {
           await db.collection("users").doc(doc.id).collection("courses").doc(courseId.toString()).set({
             lastSynced: FieldValue.serverTimestamp(),
             courseId: courseId
           }, { merge: true });
        }

      } catch (err) {
        console.error(`Error syncing for user ${doc.id}:`, err);
      }
    }
  } catch (error) {
    console.error("Error fetching active users:", error);
  }
});

export const scheduleRemindersOnCreate = onDocumentCreated("users/{userId}/assignments/{assignmentId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data();

  if (!data.deadlineISO) {
    return;
  }

  const dueDate = new Date(data.deadlineISO).getTime();
  const createdDate = Date.now();

  // Calculate Halfway Alert
  const halfwayAlertTime = createdDate + ((dueDate - createdDate) / 2);

  // Get user preference for proximity alert
  const userDoc = await db.collection("users").doc(event.params.userId).get();
  const userData = userDoc.data();
  let proximityHours = 24; // default
  if (userData && userData.reminderFrequency) {
    if (userData.reminderFrequency === '48h') proximityHours = 48;
    else if (userData.reminderFrequency === '2h') proximityHours = 2;
  }

  // Calculate Proximity Alerts
  const proximityAlertTime = dueDate - (proximityHours * 60 * 60 * 1000);

  console.log(`Scheduling reminders for assignment ${event.params.assignmentId}`);

  await snap.ref.set({
    reminders: {
      halfwayAlertScheduled: new Date(halfwayAlertTime).toISOString(),
      proximityAlertScheduled: new Date(proximityAlertTime).toISOString(),
      halfwaySent: false,
      proximitySent: false
    }
  }, { merge: true });

  // Send Immediate Notification
  if (userData && userData.fcmToken) {
    try {
      await getMessaging().send({
        token: userData.fcmToken,
        notification: {
          title: `New Assignment: ${data.title}`,
          body: `Due on ${new Date(data.deadlineISO).toLocaleString()}. Reminders scheduled.`
        }
      });
    } catch (err) {
      console.error(`Failed to send immediate FCM notification for user ${event.params.userId}:`, err);
    }
  }
});

export const processReminders = onSchedule("every 1 hours", async (event) => {
  console.log("Starting hourly reminder processing...");
  const now = Date.now();

  try {
    const usersSnapshot = await db.collection("users").where("isActive", "==", true).get();

    for (const userDoc of usersSnapshot.docs) {
      const userData = userDoc.data();
      if (!userData.fcmToken) continue; // Skip if no way to send notification

      const assignmentsSnapshot = await db.collection("users").doc(userDoc.id).collection("assignments").get();

      for (const assignmentDoc of assignmentsSnapshot.docs) {
        const assignmentData = assignmentDoc.data();
        if (!assignmentData.reminders) continue;

        const reminders = assignmentData.reminders;
        const updates: any = {};

        // Check Halfway Alert
        if (reminders.halfwayAlertScheduled && !reminders.halfwaySent) {
           const halfwayTime = new Date(reminders.halfwayAlertScheduled).getTime();
           if (now >= halfwayTime) {
             try {
                await getMessaging().send({
                  token: userData.fcmToken,
                  notification: {
                    title: `Halfway Reminder: ${assignmentData.title}`,
                    body: `You are halfway to the deadline: ${new Date(assignmentData.deadlineISO).toLocaleString()}.`
                  }
                });
                updates['reminders.halfwaySent'] = true;
             } catch(err) {
                console.error(`Failed to send halfway reminder to ${userDoc.id}:`, err);
             }
           }
        }

        // Check Proximity Alert
        if (reminders.proximityAlertScheduled && !reminders.proximitySent) {
           const proximityTime = new Date(reminders.proximityAlertScheduled).getTime();
           if (now >= proximityTime) {
             try {
                await getMessaging().send({
                  token: userData.fcmToken,
                  notification: {
                    title: `Deadline Approaching: ${assignmentData.title}`,
                    body: `Due soon: ${new Date(assignmentData.deadlineISO).toLocaleString()}.`
                  }
                });
                updates['reminders.proximitySent'] = true;
             } catch(err) {
                console.error(`Failed to send proximity reminder to ${userDoc.id}:`, err);
             }
           }
        }

        // Save updates if any reminders were sent
        if (Object.keys(updates).length > 0) {
           await assignmentDoc.ref.update(updates);
        }
      }
    }
  } catch (error) {
    console.error("Error processing reminders:", error);
  }
});

import { HttpsError, onCall } from 'firebase-functions/v2/https';

export const connectLms = onCall(async (request) => {
  const { lmsUsername, lmsPassword, lmsUrl, apiKey } = request.data;
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  if (!lmsUsername || !lmsPassword) {
    throw new HttpsError('invalid-argument', 'Missing credentials.');
  }

  await db.collection("users").doc(uid).set({
    isActive: true,
    username: lmsUsername,
    password: encrypt(lmsPassword),
    lmsUrl: encrypt(lmsUrl || "https://lms.vit.ac.in/login/index.php"),
    openRouterKey: encrypt(apiKey),
    reminderFrequency: '24h', // Default proximity alert
    theme: {
      primary: '#2563eb',
      accent: '#1e4fc2',
      background: '#f5f7fb'
    }
  }, { merge: true });

  return { success: true };
});

export const chatAgent = onCall(async (request) => {
  const { message, history } = request.data;
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data();
  if (!userData) {
    throw new HttpsError('not-found', 'User profile not found.');
  }

  // Decrypt OpenRouter/OpenAI Key if they stored one, or use a default one from environment variables
  const apiKey = userData.openRouterKey ? decrypt(userData.openRouterKey) : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'OpenAI/OpenRouter API key is missing.');
  }

  const assignmentsSnapshot = await db.collection("users").doc(uid).collection("assignments").get();
  const assignments = assignmentsSnapshot.docs.map(doc => doc.data());

  const promptCtx = `Here is the user's current assignment data from their LMS:
${JSON.stringify(assignments, null, 2)}
`;

  const systemPrompt = message === '__DIGEST__'
     ? `You are an AI study assistant. Generate a concise daily study digest for the student based on their active assignments.`
     : `You are an AI study assistant helping a student manage their coursework. Use the provided context to answer questions.`;

  const userMessage = message === '__DIGEST__' ? 'Generate my daily digest.' : message;

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({
      apiKey,
      baseURL: userData.openRouterKey ? "https://openrouter.ai/api/v1" : undefined
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // OpenRouter maps this if they use that backend
      messages: [
        { role: 'system', content: systemPrompt + "\n" + promptCtx },
        ...(history || []),
        { role: 'user', content: userMessage }
      ]
    });

    return { reply: completion.choices[0]?.message?.content || "No response generated." };
  } catch (error: any) {
    console.error('AI Error:', error);
    throw new HttpsError('internal', `Failed to generate AI response: ${error.message}`);
  }
});
