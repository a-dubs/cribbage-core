# backend/Dockerfile
FROM node:22-slim

# Set timezone
ENV TZ=America/New_York

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN npm install

# Copy .env into container
COPY .env .env

# Start backend
CMD ["npm", "run", "start-server"]
