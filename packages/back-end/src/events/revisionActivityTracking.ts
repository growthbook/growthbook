import { createHash } from "crypto";
import { z } from "zod";
import { entityTrackingKey } from "shared/util";
import { ReqContext } from "back-end/types/request";
import { trackEventForContext } from "back-end/src/services/growthbook";

// "reviewRequested" -> "Revision Review Requested": an event per action, so a
// metric on one is just its name.
export function revisionActivityEventName(
  action: string,
): `Revision ${string}` {
  const words = action.replace(/([A-Z])/g, " $1");
  return `Revision ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

const revisionEventData = z.object({
  object: z.object({ version: z.number() }),
});

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

// Revision and review activity on features, saved groups, configs and
// constants, logged beside the app event that records it. The entity and
// revision are hashed so a metric can count them distinctly.
export function trackRevisionActivity(
  context: ReqContext,
  resource: string,
  event: string,
  entityId: string | null,
  data: unknown,
): void {
  if (!event.startsWith("revision.")) return;
  const action = event.slice("revision.".length);
  const parsed = revisionEventData.safeParse(data);
  const version = parsed.success ? parsed.data.object.version : null;
  const orgId = context.org.id;
  trackEventForContext(context, revisionActivityEventName(action), {
    resource,
    action,
    actor: context.auditUser?.type ?? "system",
    ...(entityId !== null && {
      entity_id_hash: md5(entityTrackingKey(orgId, entityId)),
      ...(version !== null && {
        revision_id_hash: md5(entityTrackingKey(orgId, entityId, version)),
        revision_version: version,
      }),
    }),
  });
}
