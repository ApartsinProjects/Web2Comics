FROM mcr.microsoft.com/playwright:v1.41.0-jammy

WORKDIR /app

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./
RUN npm ci

COPY engine ./engine
COPY telegram ./telegram
COPY package.json ./package.json

EXPOSE 10000

CMD ["node", "telegram/src/webhook-bot.js"]
