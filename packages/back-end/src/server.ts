import { Socket } from "net";
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

// pino-http only logs on response finish, so a connection that dies mid-request
// leaves no trace here even though the load balancer records it as a 502.
server.on("request", (req, res) => {
  const start = Date.now();
  res.on("close", () => {
    if (res.writableFinished) return;
    logger.warn(
      {
        method: req.method,
        url: req.url,
        headersSent: res.headersSent,
        readableAborted: req.readableAborted,
        elapsedMs: Date.now() - start,
        traceId: req.headers["x-amzn-trace-id"],
        remoteAddress: req.socket.remoteAddress,
      },
      "Response closed before finishing",
    );
  });
});

server.on("clientError", (err, socket) => {
  const code = (err as NodeJS.ErrnoException).code;
  logger.warn(
    {
      err,
      code,
      remoteAddress:
        socket instanceof Socket ? socket.remoteAddress : undefined,
    },
    "Client error before request was handled",
  );
  // Registering this listener suppresses Node's default response, so mirror it.
  if (code === "ECONNRESET" || !socket.writable) return;
  if (code === "HPE_HEADER_OVERFLOW") {
    socket.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
    return;
  }
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
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
