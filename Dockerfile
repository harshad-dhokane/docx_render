# Use Node.js 20 as the base image
FROM node:20-slim

# Install LibreOffice and dependencies
RUN apt-get update && \
    apt-get install -y \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory and create node user
WORKDIR /usr/src/app
RUN groupadd -r nodejs && \
    useradd -r -g nodejs -s /bin/bash -d /usr/src/app nodejs && \
    chown -R nodejs:nodejs /usr/src/app

# Copy package files
COPY --chown=nodejs:nodejs package*.json ./

# Install dependencies and TypeScript globally
RUN npm install && \
    npm install -g typescript

# Copy the rest of the application
COPY --chown=nodejs:nodejs . .

# Switch to node user
USER nodejs

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
