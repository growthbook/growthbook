import repl from "node:repl";
import * as Organization from "./src/models/OrganizationModel";
import * as Event from "./src/models/EventModel";
import mongoInit from "./src/init/mongo";

(async () => {
  const replServer = repl.start({
    prompt: "🚀 growthbook > ",
  });

  await mongoInit();

  // Add globals you want available to the context
  replServer.context.Organization = Organization;
  replServer.context.Event = Event;
})();
