FROM node:20-alpine AS base
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/driver/package.json ./apps/driver/package.json
COPY apps/printer-agent/package.json ./apps/printer-agent/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @delivery/web --include-workspace-root

COPY . .
RUN npm run build -w @delivery/web

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@delivery/web"]
