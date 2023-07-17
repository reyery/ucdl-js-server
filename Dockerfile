FROM node:lts-alpine

WORKDIR /app
COPY . .

RUN npm ci

EXPOSE 5202

CMD [ "node", "--max-old-space-size=262144 app.js" ]