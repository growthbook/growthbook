module.exports = {
  apps: [
    {
      name: "back-end-datadog",
      script: "dist/server.js",
      cwd: "./packages/back-end",
      node_args: "--require ./dist/tracing.datadog.js",
      instances: 1,
      autorestart: process.env.PM2_AUTORESTART === "true",
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "6G",
    },
    {
      name: "front-end",
      script: "./start-front-end.js",
      instances: 1,
      autorestart: process.env.PM2_AUTORESTART === "true",
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "6G",
    },
  ],
};
