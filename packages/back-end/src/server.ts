import "./init/aliases";
import "./init/dotenv";
import "./instrumentation";
import app from "./app";
import { logger } from "./util/logger";
import { getAgendaInstance } from "./services/queueing";
import { uploadsInit } from "./init/uploads";
import {
  initializeGrowthBookClient,
  destroyGrowthBookClient,
} from "./services/growthbook";
import { statsServerPool } from "./services/python";

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
});

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

    // Bounded: a stats call from a background job (not covered by
    // server.close()'s in-flight-request wait above) can hold a resource for
    // up to GB_STATS_ENGINE_TIMEOUT_MS - far longer than the platform's
    // SIGTERM->SIGKILL grace period. Give it a short grace period, then clear
    // whatever's left rather than block Agenda/exit indefinitely.
    await Promise.race([
      statsServerPool.drain(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await statsServerPool.clear();

    // Gracefully close Agenda
    const agenda = getAgendaInstance();
    await agenda.stop();
    logger.info("Agenda closed");
    process.exit(0);
  });
}
