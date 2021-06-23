FROM node:14-alpine

# Install python for stats models
RUN apk add --no-cache \
  python3 \
  py3-numpy \
  py3-scipy

WORKDIR /usr/local/src/app

# Copy only the required files
COPY . /usr/local/src/app

RUN \
  # Install app with dev dependencies
  yarn install --frozen-lockfile --ignore-optional \
  # Build the app
  && yarn build \
  # Then do a clean install with only production dependencies
  && rm -rf node_modules \
  && yarn install --frozen-lockfile --production=true --ignore-optional \
  # Clear the yarn cache
  && yarn cache clean

# The front-end app (NextJS)
EXPOSE 3000
# The back-end api (Express)
EXPOSE 3100

CMD ["yarn","start"]
