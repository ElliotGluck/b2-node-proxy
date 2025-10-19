# Use official Node.js LTS image
FROM node:20-alpine

# Install wget for healthchecks
RUN apk add --no-cache wget

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY index.js ./

# Expose port (configurable via PORT env var, defaults to 3000)
EXPOSE 3000

# Set non-root user for security
USER node

# Start the application
CMD ["node", "index.js"]
