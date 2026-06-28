FROM node:lts-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

EXPOSE 3000

ENV PORT=3000

CMD ["node", "build/index.js"]
