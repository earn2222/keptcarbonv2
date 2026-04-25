FROM node:20-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the app
COPY . .

# Expose Next.js dev port
EXPOSE 3000

# Run in development mode
CMD ["npm", "run", "dev"]
