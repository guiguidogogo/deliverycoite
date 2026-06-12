FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install

COPY . .
RUN npm run prisma:generate -w @delivery/api
RUN npm run build -w @delivery/api

EXPOSE 3333
CMD ["npm", "run", "start", "-w", "@delivery/api"]
