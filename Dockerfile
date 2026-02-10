FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ build-essential && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN cp -n config.json.example config.json 2>/dev/null || true
RUN mkdir -p /app/data && ln -sf /app/data/db.sqlite3 /app/db.sqlite3

CMD ["node", "index.js"]
