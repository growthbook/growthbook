import app from "./app";
import { logger } from "./util/logger";

const server = app.listen(app.get("port"), () => {
  logger.info(
    `Back-end is running at http://localhost:${app.get("port")} in ${app.get(
      "env"
    )} mode. Press CTRL-C to stop`
  );
});

export default server;

// App-level error handling
class UnhandledRejectionError extends Error {
  public promise: Promise<unknown>;
  constructor(message: string, promise: Promise<unknown>) {
    super(message);
    this.name = "UnhandledRejectionError";
    this.promise = promise;
  }
}
process.on("unhandledRejection", (reason, promise) => {
  throw new UnhandledRejectionError(reason as string, promise);
});
process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught Exception");
});
