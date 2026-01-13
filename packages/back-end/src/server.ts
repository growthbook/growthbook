import "./init/aliases";
import "./init/dotenv";
import "./instrumentation";
import app from "./app";
import { logger } from "./util/logger";
import { getAgendaInstance } from "./services/queueing";
import {
  initializeGrowthBookClient,
  destroyGrowthBookClient,
} from "./services/growthbook";

// Initialize GrowthBook singleton before starting server
initializeGrowthBookClient().catch((error) => {
  logger.error("Failed to initialize GrowthBook at startup", { error });
});

const server = app.listen(app.get("port"), () => {
  logger.info(
    `Back-end is running at http://localhost:${app.get("port")} in ${app.get(
      "env",
    )} mode. Press CTRL-C to stop`,
  );
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

    // Gracefully close Agenda
    const agenda = getAgendaInstance();
    await agenda.stop();
    logger.info("Agenda closed");
    process.exit(0);
  });
}
