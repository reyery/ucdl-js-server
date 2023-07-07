FROM node:lts-alpine

WORKDIR /app
COPY . .

RUN npm ci

EXPOSE 5202

CMD [ "node", "--max-old-space-size=512000 app.js" ]