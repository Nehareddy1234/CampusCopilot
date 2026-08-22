# Use the official Microsoft Playwright image as the base to ensure all OS dependencies are met
FROM mcr.microsoft.com/playwright:v1.50.1-jammy

WORKDIR /usr/src/app

# Copy package.json and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the pre-built application
COPY lib/ ./lib/

# Set the environment variable for Firebase Functions/Cloud Run
ENV PORT=8080
EXPOSE 8080

# In a pure Cloud Run setup, we would run an Express wrapper, but since these are Firebase Gen2 functions,
# the user can deploy this container directly to Cloud Run or use Firebase CLI container support.
# We will use the Firebase Functions framework to serve it.
RUN npm install -g @google-cloud/functions-framework
CMD ["npx", "functions-framework", "--target=scheduledMoodleSync"]
