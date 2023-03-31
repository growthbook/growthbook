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
interface UnhandledRejectionError extends Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promise: Promise<any>;
}
process.on("unhandledRejection", (reason, promise) => {
  const err = new Error(reason as string) as UnhandledRejectionError;
  err.promise = promise;
  logger.error(err, "Unhandled Rejection");
});
process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught Exception");
});
