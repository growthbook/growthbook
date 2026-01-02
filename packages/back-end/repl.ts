import repl from "node:repl";
import * as ApiKey from "./src/models/ApiKeyModel";
import * as Organization from "./src/models/OrganizationModel";
import * as Event from "./src/models/EventModel";
import * as EventWebHook from "./src/models/EventWebhookModel";
import * as EventWebHookLog from "./src/models/EventWebHookLogModel";
import * as Project from "./src/models/ProjectModel";
import * as SlackIntegration from "./src/models/SlackIntegrationModel";
import * as InformationSchema from "./src/models/InformationSchemaModel";
import * as VisualChangeset from "./src/models/VisualChangesetModel";
import mongoInit from "./src/init/mongo";

(async () => {
  const replServer = repl.start({
    prompt: "🚀 growthbook > ",
  });

  await mongoInit();

  // Add globals you want available to the context
  replServer.context.ApiKey = ApiKey;
  replServer.context.Organization = Organization;
  replServer.context.Event = Event;
  replServer.context.EventWebHook = EventWebHook;
  replServer.context.EventWebHookLog = EventWebHookLog;
  replServer.context.Project = Project;
  replServer.context.SlackIntegration = SlackIntegration;
  replServer.context.InformationSchema = InformationSchema;
  replServer.context.VisualChangeset = VisualChangeset;
})();
