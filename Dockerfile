FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data
ENV DATABASE_PATH=/app/data/db.sqlite3

CMD ["node", "index.js"]
