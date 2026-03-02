import { z } from "zod";
import { entityEvents, entityTypes } from "shared/constants";
import type { EventType } from "shared/types/audit";
import { baseSchema } from "./base-model";

export const auditUserLoggedIn = z.strictObject({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export const auditUserApiKey = z.strictObject({
  apiKey: z.string(),
});
export const auditUserSystem = z.strictObject({
  system: z.literal(true),
});

const auditUser = z.union([
  auditUserLoggedIn,
  auditUserApiKey,
  auditUserSystem,
]);

const auditEntity = z.strictObject({
  object: z.enum(entityTypes),
  id: z.string(),
  name: z.string().optional(),
});

const auditParent = z.strictObject({
  object: z.enum(entityTypes),
  id: z.string(),
});

const auditEvent: z.ZodType<EventType> = z.string() as z.ZodType<EventType>;

export const auditSchema = baseSchema
  .safeExtend({
    user: auditUser,
    reason: z.string().optional(),
    event: auditEvent,
    entity: auditEntity,
    parent: auditParent.optional(),
    details: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const entity = data.entity.object;
    if (data.parent && data.parent.object !== entity) {
      ctx.addIssue({
        code: "custom",
        path: ["parent", "object"],
        message:
          "parent.object must be of the same entity type as entity.object",
      });
    }
    if (!data.event.startsWith(`${entity}.`)) {
      ctx.addIssue({
        code: "custom",
        path: ["event"],
        message: `event must correspond to entity.object \`${entity}\``,
      });
    } else if (
      // This case should be unreachable due to the original zod enum validation
      !entityEvents[entity].some((event) => data.event === `${entity}.${event}`)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["event"],
        message: `event must be a valid event of format \`${entity}.{eventType}\``,
      });
    }
  });
