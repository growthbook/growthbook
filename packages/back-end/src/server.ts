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
