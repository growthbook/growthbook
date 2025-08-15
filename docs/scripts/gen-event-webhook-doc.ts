import fs from "node:fs";
import path from "node:path";
import {
  notificationEvents,
  notificationEventPayload,
} from "back-end/src/events/base-types";
import { z } from "zod";
// eslint-disable-next-line import/no-unresolved
import { zodToTs, printNode } from "zod-to-ts";

const basePath = path.resolve(path.dirname(process.argv[1]), "..");

const TARGET = `${basePath}/src/partials/event-webhook/_event-webhook-list.md`;

const typeScriptSchema = <T extends z.ZodTypeAny>(schema: T) =>
  printNode(zodToTs(schema).node);

const events = Object.keys(notificationEvents).reduce(
  (events, resource) => [
    ...events,
    ...Object.keys(notificationEvents[resource])
      .filter((event) => !notificationEvents[resource][event].noDoc)
      .map((event) => ({
        name: `${resource}.${event}`,
        description: notificationEvents[resource][event].description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: notificationEventPayload(resource as any, event as any),
      })),
  ],
  [],
);

const eventTableEntry = ({ name, description }) =>
  `| **[${name}](#${name.replace(/\./g, "")})** | ${description} |`;

const quote = "```";

const eventEntry = ({ name, description, payload }) => `
### ${name}

${description}

<details>
  <summary>Payload</summary>

${quote}typescript
${typeScriptSchema(payload)}
${quote}
</details>
`;

const md = `
  | Event name | Description |
  |------------|-------------|
  ${events.map(eventTableEntry).join("\n")}

  ${events.map(eventEntry).join("\n")}
`;

fs.writeFileSync(TARGET, md);
