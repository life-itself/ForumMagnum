# Keep the container runtime aligned with package.json engines.node.
FROM node:24.13.0 AS builder
WORKDIR /usr/src/app
COPY . .
RUN yarn install && yarn cache clean
RUN cd ckEditor && yarn build
RUN ENV_NAME=stage1Lw FORUM_TYPE=LessWrong yarn generate
RUN ENV_NAME=stage1Lw FORUM_TYPE=LessWrong ./node_modules/.bin/next build
RUN rm -rf .next/cache tmp

FROM node:24.13.0 AS runner
ENV IS_DOCKER=true
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/package.json ./package.json
COPY --from=builder /usr/src/app/yarn.lock ./yarn.lock
COPY --from=builder /usr/src/app/next.config.ts ./next.config.ts
COPY --from=builder /usr/src/app/middleware.ts ./middleware.ts
COPY --from=builder /usr/src/app/instrumentation.js ./instrumentation.js
COPY --from=builder /usr/src/app/instrumentation-client.js ./instrumentation-client.js
COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/app ./app
COPY --from=builder /usr/src/app/packages ./packages
COPY --from=builder /usr/src/app/ckEditor/build ./ckEditor/build
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/.next ./.next
EXPOSE 8080
CMD [ "./node_modules/.bin/next", "start", "--port", "8080" ]
