module.exports = {
  apps: [
    {
      name: "back-end",
      script: "dist/server.js",
      cwd: "./packages/back-end",
      instances: 1,
      autorestart: process.env.PM2_AUTORESTART === "true",
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "6G",
      ...(process.env.TRACING_PROVIDER === "datadog" && {
        node_args: "--require ./packages/back-end/dist/tracing.datadog.js",
      }),
      ...(process.env.TRACING_PROVIDER === "opentelemetry" && {
        node_args:
          "--require ./packages/back-end/dist/tracing.opentelemetry.js",
      }),
    },
    {
      name: "front-end",
      script: "cd packages/front-end && ./node_modules/.bin/next",
      args: "start",
      instances: 1,
      autorestart: process.env.PM2_AUTORESTART === "true",
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "6G",
    },
  ],
};
