FROM node:alpine

ENV PORT=8080
ENV INSTALL_DIR=planning-poker

WORKDIR /app

COPY package.json ./
COPY src/ ./src/

RUN npm install

EXPOSE ${PORT}
CMD ["npm", "run", "start"]