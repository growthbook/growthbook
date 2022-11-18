import repl from "repl";
import * as Organization from "./src/models/OrganizationModel";
import mongoInit from "./src/init/mongo";

(async () => {
  const replServer = repl.start({
    prompt: "🚀 growthbook > ",
  });

  await mongoInit();

  // Add globals you want available to the context
  replServer.context.Organization = Organization;
})();
