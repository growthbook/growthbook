import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  NotificationEventPayloadSchemaType,
  ResourceEvents,
} from "shared/types/events/base-types";
import { FeatureRevisionUpdatedPayload } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { createEvent, CreateEventData } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";
import { revisionToApiInterface } from "back-end/src/services/features";
import { auditDetailsUpdate } from "back-end/src/services/audit";

type RevisionChange = FeatureRevisionUpdatedPayload["change"];

type FeatureRevisionEvent = Extract<
  ResourceEvents<"feature">,
  `revision.${string}`
>;

// Callers supply the event-specific fields. The dispatcher itself fills in
// the revision snapshot (from revisionToApiInterface) plus routing fields.
type RevisionBaseKeys =
  | "featureId"
  | "version"
  | "status"
  | "orgId"
  | keyof ReturnType<typeof revisionToApiInterface>;

type ExtraPayload<T extends FeatureRevisionEvent> = Omit<
  NotificationEventPayloadSchemaType<"feature", T>,
  RevisionBaseKeys
>;

// Dispatch a `feature.revision.*` webhook event. Pulls projects/environments/tags
// from the parent feature so downstream Slack/webhook filters work the same as
// regular feature events. Failures are logged and swallowed — events are
// fire-and-forget and should never break the caller.
export async function dispatchFeatureRevisionEvent<
  T extends FeatureRevisionEvent,
>(
  ctx: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  event: T,
  extra: ExtraPayload<T>,
  opts: { environments?: string[] } = {},
): Promise<void> {
  try {
    const apiRevision = revisionToApiInterface(revision);
    const projects = feature.project ? [feature.project] : [];
    const tags = feature.tags ?? [];
    // Environment filter precedence:
    //   1. Caller-provided (e.g. specific env(s) touched for revision.updated)
    //   2. Envs declared on the revision
    //   3. All envs configured on the feature
    const environments =
      opts.environments ??
      (revision.rules && Object.keys(revision.rules).length > 0
        ? Object.keys(revision.rules)
        : Object.keys(feature.environmentSettings ?? {}));

    const object = {
      ...apiRevision,
      featureId: feature.id,
      version: revision.version,
      status: revision.status,
      orgId: ctx.org.id,
      ...extra,
    };

    await createEvent({
      context: ctx,
      object: "feature",
      objectId: feature.id,
      event,
      data: { object } as CreateEventData<"feature", T>,
      projects,
      tags,
      environments,
      containsSecrets: false,
    });
  } catch (e) {
    logger.error(e, `Error dispatching feature revision event ${event}`);
  }
}

// Convenience for draft-mutation endpoints. Emits both an audit log entry and
// a `feature.revision.updated` webhook event with a consistent shape.
// Callers supply the `change` discriminator and (optionally) the environments
// that were actually touched so downstream filters only match relevant subs.
export async function recordRevisionUpdate(
  ctx: ReqContext | ApiReqContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: { audit: (entry: any) => Promise<void> },
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  change: RevisionChange,
  opts: {
    environments?: string[];
    // Extra audit detail fields merged into the audit `details` payload.
    auditDetails?: Record<string, unknown>;
  } = {},
): Promise<void> {
  await req.audit({
    event: "feature.revision.update",
    entity: { object: "feature", id: feature.id },
    details: auditDetailsUpdate(
      { version: revision.version },
      { version: revision.version },
      { change, ...opts.auditDetails },
    ),
  });

  await dispatchFeatureRevisionEvent(
    ctx,
    feature,
    revision,
    "revision.updated",
    {
      change,
      ...(opts.environments ? { environments: opts.environments } : {}),
    },
    { environments: opts.environments },
  );
}
