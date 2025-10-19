# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY index.js ./

# Expose port
EXPOSE 3000

# Set non-root user for security
USER node

# Start the application
CMD ["node", "index.js"]
