FROM node:14-alpine

WORKDIR /usr/local/src/app

# Copy only the required files
COPY . /usr/local/src/app

RUN \
  # Install with dev dependencies
  yarn install --frozen-lockfile --ignore-optional \
  # Build the app
  && yarn build \
  # Then do a clean install with only production dependencies
  && rm -rf node_modules \
  && yarn install --frozen-lockfile --production=true --ignore-optional \
  # Clear the yarn cache
  && yarn cache clean

CMD ["yarn","start"]
