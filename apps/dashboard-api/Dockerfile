FROM node:20-bullseye-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 4000

CMD ["npm", "run", "start"]
