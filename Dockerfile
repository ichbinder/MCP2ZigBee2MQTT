FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /data

# Expose MCP server (stdio mode, no port needed)
# Health check endpoint could be added later

CMD ["node", "dist/index.js"]
