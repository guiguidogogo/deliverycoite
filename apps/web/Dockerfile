FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN npm install

COPY . .
RUN npm run build -w @delivery/web

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@delivery/web"]
