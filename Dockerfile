FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public

RUN bun build ./src/server.ts --target bun --outfile ./dist/server.js

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/obx.sqlite
ENV LOG_FORMAT=json
ENV LOG_LEVEL=info

COPY --from=build /app/dist/server.js ./dist/server.js
COPY --from=build /app/public ./public

RUN mkdir -p /data

EXPOSE 3000

CMD ["bun", "run", "dist/server.js"]
