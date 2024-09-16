import fs from "node:fs";
import path from "node:path";
import { notificationEvents } from "back-end/src/events/base-types";

const basePath = path.resolve(path.dirname(process.argv[1]), "..");

const TARGET = `${basePath}/src/partials/event-webhook/_event-webhook-list.md`;

const events = Object.keys(notificationEvents).reduce(
  (events, resource) => [
    ...events,
    ...Object.keys(notificationEvents[resource])
      .filter((event) => !notificationEvents[resource][event].noDoc)
      .map((event) => `${resource}.${event}`),
  ],
  []
);

const md = events.map((event) => `- **${event}**`).join("\n");

fs.writeFileSync(TARGET, md);
