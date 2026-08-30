# Production-ready Playwright container on Ubuntu Noble with pre-installed Chromium & system dependencies
FROM mcr.microsoft.com/playwright:noble

WORKDIR /app

# Install package dependencies first for Docker caching
COPY package*.json ./
RUN npm ci

# Copy TypeScript configs and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# Render and generic production environments
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
EXPOSE 10000

# Start compiled microservice
CMD ["node", "dist/index.js"]
