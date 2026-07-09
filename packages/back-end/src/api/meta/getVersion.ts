import { getVersionValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getBuild } from "back-end/src/util/build";

export const getVersion = createApiRequestHandler(getVersionValidator)(
  async () => {
    const build = getBuild();
    return {
      version: build.lastVersion,
      commit: build.sha,
      date: build.date,
    };
  },
);
