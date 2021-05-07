FROM node:alpine

WORKDIR /usr/local/src/app

COPY ./dist /usr/local/src/app/dist
COPY ./package.json /usr/local/src/app/package.json
COPY ./yarn.lock /usr/local/src/app/yarn.lock

RUN yarn install --frozen-lockfile --production=true --ignore-optional \
  && rm -rf /usr/local/share/.cache/yarn

CMD ["yarn","start"]
