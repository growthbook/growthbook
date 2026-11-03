import "./init/aliases";
import "./init/distrustRoots";
import "./init/dotenv";
import "./instrumentation";
import app from "./app";
import { logger } from "./util/logger";
import { getAgendaInstance } from "./services/queueing";
import { uploadsInit } from "./init/uploads";
import {
  KEEP_ALIVE_TIMEOUT_MS,
  OAUTH_AS_ENABLED,
  OAUTH_ISSUER,
} from "./util/secrets";
import {
  initializeGrowthBookClient,
  destroyGrowthBookClient,
} from "./services/growthbook";

// Initialize GrowthBook singleton before starting server
initializeGrowthBookClient().catch((error) => {
  logger.error({ err: error }, "Failed to initialize GrowthBook at startup");
});

const server = app.listen(app.get("port"), () => {
  logger.info(
    `Back-end is running at http://localhost:${app.get("port")} in ${app.get(
      "env",
    )} mode. Press CTRL-C to stop`,
  );
  // Boot-time operational check (real server only; not exercised by tests, which
  // import app directly). Self-contained and warn-only.
  void uploadsInit();
  // OAuth clients compare the issuer byte for byte, and a request's host isn't stable.
  if (OAUTH_AS_ENABLED && !OAUTH_ISSUER) {
    logger.warn(
      "The OAuth Authorization Server is on, but neither OAUTH_ISSUER nor API_HOST is set, " +
        "so it advertises each request's host as its issuer. MCP sign-in breaks if the API " +
        "is reached under more than one hostname or behind a proxy that rewrites the host. " +
        "Set OAUTH_ISSUER or API_HOST, or set OAUTH_AS_ENABLED=0 to turn it off.",
    );
  }
});

server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

export default server;

process.on("unhandledRejection", (rejection: unknown) => {
  if (["string", "number", "boolean"].includes(typeof rejection)) {
    logger.error(new Error(rejection + ""), "Unhandled Rejection");
    return;
  }
  logger.error(rejection, "Unhandled Rejection");
});
process.on("uncaughtException", (err: Error) => {
  logger.error(err, "Uncaught Exception");
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM signal received");
  onClose();
});
process.on("SIGINT", async () => {
  logger.info("SIGINT signal received");
  onClose();
});
function onClose() {
  // stop Express server
  server.close(async () => {
    logger.info("HTTP server closed");

    // Cleanup GrowthBook client
    destroyGrowthBookClient();

    // Gracefully close Agenda
    const agenda = getAgendaInstance();
    await agenda.stop();
    logger.info("Agenda closed");
    process.exit(0);
  });

  // close() only reaps sockets that are already idle; one that goes idle after
  // its in-flight request finishes would hold the server open for keepAliveTimeout
  setInterval(() => server.closeIdleConnections(), 250).unref();
}
