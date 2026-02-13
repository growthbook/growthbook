import "./init/aliases.js";
import "./init/dotenv.js";
import "./instrumentation.js";
import app from "./app.js";
import { logger } from "./util/logger.js";
import { getAgendaInstance } from "./services/queueing.js";

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
    // Gracefully close Agenda
    const agenda = getAgendaInstance();
    await agenda.stop();
    logger.info("Agenda closed");
    process.exit(0);
  });
}
