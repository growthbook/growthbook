// Absolute so the path doesn't depend on the app's cwd, and an array so a
// directory with a space in it can't split the argument.
const tracingArgs = (provider) => [
  "--require",
  `${__dirname}/packages/back-end/dist/tracing.${provider}.js`,
];

module.exports = {
  apps: [
    {
      name: "back-end",
      script: "dist/server.js",
      cwd: "./packages/back-end",
      autorestart: process.env.PM2_AUTORESTART === "true",
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "6G",
      ...(process.env.TRACING_PROVIDER === "datadog" && {
        node_args: tracingArgs("datadog"),
      }),
      ...(process.env.TRACING_PROVIDER === "opentelemetry" && {
        node_args: tracingArgs("opentelemetry"),
      }),
    },
    {
      name: "front-end",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: "./packages/front-end",
      autorestart: process.env.PM2_AUTORESTART === "true",
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "6G",
    },
    // Idle monitor for preview environments - shuts down the container after
    // inactivity. Shell-free (reads /proc) so it runs on the distroless image.
    ...(process.env.PREVIEW_IDLE_TIMEOUT_SECONDS
      ? [
          {
            name: "idle-monitor",
            script: "./preview/idle-monitor.js",
            autorestart: false,
          },
        ]
      : []),
  ],
};
