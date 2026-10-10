FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir /data && chown node:node /data
USER node
ENV HOST=0.0.0.0 PORT=4173 NODE_ENV=production DATA_DIR=/data
EXPOSE 4173
CMD ["node","server.mjs"]
