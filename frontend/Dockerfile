FROM node:20-alpine

# Set work directory
WORKDIR /app

# Install dependencies first
COPY package.json package-lock.json* ./
RUN npm install

# Copy application files
COPY . .

# Expose Next.js default port
EXPOSE 3000

# Run in development mode
CMD ["npm", "run", "dev"]
