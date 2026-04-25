# Keep the container runtime aligned with package.json engines.node.
FROM node:24.13.0
ENV IS_DOCKER=true
# Transcrypt dependency
RUN apt-get update && apt-get install -y bsdmainutils
# Install transcrypt for EA Forum
RUN curl -sSLo /usr/local/bin/transcrypt https://raw.githubusercontent.com/elasticdog/transcrypt/2f905dce485114fec10fb747443027c0f9119caa/transcrypt && chmod +x /usr/local/bin/transcrypt
WORKDIR /usr/src/app
COPY . .
RUN yarn install && yarn cache clean
RUN ENV_NAME=stage1Lw FORUM_TYPE=LessWrong yarn generate
RUN ENV_NAME=stage1Lw FORUM_TYPE=LessWrong ./node_modules/.bin/next build
EXPOSE 8080
CMD [ "./node_modules/.bin/next", "start", "--port", "8080" ]
