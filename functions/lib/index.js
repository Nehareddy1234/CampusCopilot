"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatAgent = exports.connectLms = exports.processReminders = exports.scheduleRemindersOnCreate = exports.scheduledMoodleSync = void 0;
const admin = require("firebase-admin");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_2 = require("firebase-functions/v2/firestore");
const automation_1 = require("./automation");
const encryption_1 = require("./encryption");
admin.initializeApp();
const db = (0, firestore_1.getFirestore)();
exports.scheduledMoodleSync = (0, scheduler_1.onSchedule)("every 24 hours", async (event) => {
    console.log("Starting scheduled Moodle sync...");
    try {
        const usersSnapshot = await db.collection("users").where("isActive", "==", true).get();
        for (const doc of usersSnapshot.docs) {
            const userData = doc.data();
            console.log(`Syncing for user ${doc.id}`);
            try {
                const result = await (0, automation_1.loginToLMS)(userData.username, (0, encryption_1.decrypt)(userData.password), // Decrypt credentials securely
                (0, encryption_1.decrypt)(userData.lmsUrl) || "https://lms.vit.ac.in/login/index.php");
                // Update assignments in Firestore
                for (const assignment of result.assignments) {
                    // Use a deterministic ID based on title and course to prevent duplicates
                    const assignmentId = Buffer.from(`${assignment.courseId}-${assignment.title}`).toString('base64').replace(/[/+=]/g, '');
                    await db.collection("users").doc(doc.id).collection("assignments").doc(assignmentId).set({
                        ...assignment,
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                        createdDate: firestore_1.FieldValue.serverTimestamp() // Assuming it's new for the reminder calculations
                    }, { merge: true });
                }
                // Update course sync timestamp
                for (const courseId of result.allowlist) {
                    await db.collection("users").doc(doc.id).collection("courses").doc(courseId.toString()).set({
                        lastSynced: firestore_1.FieldValue.serverTimestamp(),
                        courseId: courseId
                    }, { merge: true });
                }
            }
            catch (err) {
                console.error(`Error syncing for user ${doc.id}:`, err);
            }
        }
    }
    catch (error) {
        console.error("Error fetching active users:", error);
    }
});
exports.scheduleRemindersOnCreate = (0, firestore_2.onDocumentCreated)("users/{userId}/assignments/{assignmentId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
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
        if (userData.reminderFrequency === '48h')
            proximityHours = 48;
        else if (userData.reminderFrequency === '2h')
            proximityHours = 2;
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
            await (0, messaging_1.getMessaging)().send({
                token: userData.fcmToken,
                notification: {
                    title: `New Assignment: ${data.title}`,
                    body: `Due on ${new Date(data.deadlineISO).toLocaleString()}. Reminders scheduled.`
                }
            });
        }
        catch (err) {
            console.error(`Failed to send immediate FCM notification for user ${event.params.userId}:`, err);
        }
    }
});
exports.processReminders = (0, scheduler_1.onSchedule)("every 1 hours", async (event) => {
    console.log("Starting hourly reminder processing...");
    const now = Date.now();
    try {
        const usersSnapshot = await db.collection("users").where("isActive", "==", true).get();
        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();
            if (!userData.fcmToken)
                continue; // Skip if no way to send notification
            const assignmentsSnapshot = await db.collection("users").doc(userDoc.id).collection("assignments").get();
            for (const assignmentDoc of assignmentsSnapshot.docs) {
                const assignmentData = assignmentDoc.data();
                if (!assignmentData.reminders)
                    continue;
                const reminders = assignmentData.reminders;
                const updates = {};
                // Check Halfway Alert
                if (reminders.halfwayAlertScheduled && !reminders.halfwaySent) {
                    const halfwayTime = new Date(reminders.halfwayAlertScheduled).getTime();
                    if (now >= halfwayTime) {
                        try {
                            await (0, messaging_1.getMessaging)().send({
                                token: userData.fcmToken,
                                notification: {
                                    title: `Halfway Reminder: ${assignmentData.title}`,
                                    body: `You are halfway to the deadline: ${new Date(assignmentData.deadlineISO).toLocaleString()}.`
                                }
                            });
                            updates['reminders.halfwaySent'] = true;
                        }
                        catch (err) {
                            console.error(`Failed to send halfway reminder to ${userDoc.id}:`, err);
                        }
                    }
                }
                // Check Proximity Alert
                if (reminders.proximityAlertScheduled && !reminders.proximitySent) {
                    const proximityTime = new Date(reminders.proximityAlertScheduled).getTime();
                    if (now >= proximityTime) {
                        try {
                            await (0, messaging_1.getMessaging)().send({
                                token: userData.fcmToken,
                                notification: {
                                    title: `Deadline Approaching: ${assignmentData.title}`,
                                    body: `Due soon: ${new Date(assignmentData.deadlineISO).toLocaleString()}.`
                                }
                            });
                            updates['reminders.proximitySent'] = true;
                        }
                        catch (err) {
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
    }
    catch (error) {
        console.error("Error processing reminders:", error);
    }
});
const https_1 = require("firebase-functions/v2/https");
exports.connectLms = (0, https_1.onCall)(async (request) => {
    const { lmsUsername, lmsPassword, lmsUrl, apiKey } = request.data;
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    if (!lmsUsername || !lmsPassword) {
        throw new https_1.HttpsError('invalid-argument', 'Missing credentials.');
    }
    await db.collection("users").doc(uid).set({
        isActive: true,
        username: lmsUsername,
        password: (0, encryption_1.encrypt)(lmsPassword),
        lmsUrl: (0, encryption_1.encrypt)(lmsUrl || "https://lms.vit.ac.in/login/index.php"),
        openRouterKey: (0, encryption_1.encrypt)(apiKey),
        reminderFrequency: '24h', // Default proximity alert
        theme: {
            primary: '#2563eb',
            accent: '#1e4fc2',
            background: '#f5f7fb'
        }
    }, { merge: true });
    return { success: true };
});
exports.chatAgent = (0, https_1.onCall)(async (request) => {
    const { message, history } = request.data;
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated.');
    }
    const userDoc = await db.collection("users").doc(uid).get();
    const userData = userDoc.data();
    if (!userData) {
        throw new https_1.HttpsError('not-found', 'User profile not found.');
    }
    // Decrypt OpenRouter/OpenAI Key if they stored one, or use a default one from environment variables
    const apiKey = userData.openRouterKey ? (0, encryption_1.decrypt)(userData.openRouterKey) : process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new https_1.HttpsError('failed-precondition', 'OpenAI/OpenRouter API key is missing.');
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
        const OpenAI = (await Promise.resolve().then(() => require('openai'))).default;
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
    }
    catch (error) {
        console.error('AI Error:', error);
        throw new https_1.HttpsError('internal', `Failed to generate AI response: ${error.message}`);
    }
});
//# sourceMappingURL=index.js.map