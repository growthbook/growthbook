import { createHash } from "crypto";
import type { EventInterface } from "shared/types/events/event";
import type { EventWebHookInterface } from "shared/types/event-webhook";
import {
  EventApprover,
  isDatadogEventWebHookEvent,
  EventRelatedEntity,
  EventUser,
  eventUserLabel,
} from "shared/validators";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { webhookEventEnvironments } from "back-end/src/events/handlers/utils";
import { isBookkeepingExperimentUpdate } from "back-end/src/events/experimentUpdateNoise";

// The parts of a versioned event envelope the formatter reads.
export type DatadogEnvelope = {
  event: string;
  created: number;
  data: unknown;
  projects: string[];
  tags: string[];
  environments: string[];
  user: EventUser;
  requestSource?: string;
  relatedEntities?: EventRelatedEntity[];
  approvers?: EventApprover[];
};

type JsonRecord = Record<string, unknown>;

// Datadog's limits, beyond which it rejects the event.
const MAX_KEY = 100;
const MAX_NAME = 128;
const MAX_RELATED = 100;
const MAX_TAGS = 100;
const MAX_TITLE = 500;
const MAX_VALUE = 200;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// A long key ends in a hash of the whole, so cutting it keeps it unique.
function aggregationKey(key: string): string {
  if (key.length <= MAX_KEY) return key;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
  return `${key.slice(0, MAX_KEY - hash.length - 1)}:${hash}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function eventObject(envelope: DatadogEnvelope): JsonRecord {
  return asRecord(asRecord(envelope.data).object);
}

function previousAttributes(envelope: DatadogEnvelope): JsonRecord {
  return asRecord(asRecord(envelope.data).previous_attributes);
}

// A deleted flag's event lists every configured environment; Datadog shows
// the change only where the flag was served.
export function servedEnvironments(envelope: DatadogEnvelope): string[] {
  if (envelope.event !== "feature.deleted") return envelope.environments;
  const object = eventObject(envelope);
  const settings = asRecord(object.environments);
  return object.archived
    ? []
    : envelope.environments.filter((e) => !!asRecord(settings[e]).enabled);
}

function datadogAuthor(user: EventUser): { type: string; name: string } {
  const author = authorOf(user);
  return { ...author, name: truncate(author.name, MAX_NAME) };
}

function authorOf(user: EventUser): { type: string; name: string } {
  if (!user) return { type: "system", name: "GrowthBook" };
  if (user.type === "dashboard") {
    return { type: "user", name: user.email || user.name };
  }
  if (user.type === "api_key") {
    return { type: "api", name: eventUserLabel(user) || "API key" };
  }
  if (user.subtype) {
    const label = user.subtype.replace(/-/g, " ");
    return {
      type: "automation",
      name: label.charAt(0).toUpperCase() + label.slice(1),
    };
  }
  return { type: "system", name: "GrowthBook" };
}

function summarizeRule(rule: unknown): JsonRecord {
  const r = asRecord(rule);
  const summary: JsonRecord = { id: r.id, type: r.type };
  if (r.enabled === false) summary.enabled = false;
  if (typeof r.coverage === "number") summary.coverage = r.coverage;
  if (typeof r.value === "string") summary.value = truncate(r.value, MAX_VALUE);
  if (typeof r.experimentId === "string") summary.experimentId = r.experimentId;
  return summary;
}

function featureState(object: JsonRecord, environments: string[]): JsonRecord {
  const all = asRecord(object.environments);
  return {
    defaultValue: truncate(asString(object.defaultValue), MAX_VALUE),
    environments: Object.fromEntries(
      environments.map((env) => {
        const settings = asRecord(all[env]);
        return [
          env,
          {
            enabled: !!settings.enabled,
            rules: Array.isArray(settings.rules)
              ? settings.rules.map(summarizeRule)
              : [],
          },
        ];
      }),
    ),
  };
}

function changeEvent(attributes: JsonRecord): JsonRecord {
  return {
    data: {
      type: "event",
      attributes: {
        category: "change",
        integration_id: "custom-events",
        ...attributes,
      },
    },
  };
}

type ChangeDetails = {
  resourceType: "feature_flag" | "configuration";
  name: string;
  // What happened to what, such as "Published Feature Flag checkout revision 5".
  action: string;
  // The revision comment's first line, if any.
  comment?: string;
  link: string;
  prevValue?: JsonRecord;
  newValue?: JsonRecord;
  metadata: JsonRecord;
};

function featureChange(
  envelope: DatadogEnvelope,
  environments: string[],
  appOrigin: string,
): ChangeDetails {
  const object = eventObject(envelope);
  const previous = previousAttributes(envelope);
  const id = asString(object.id);
  const revision = asRecord(object.revision);
  const version = typeof revision.version === "number" ? revision.version : 0;
  const comment = asString(revision.comment);

  const flag = `Feature Flag ${id}`;
  let action = `Updated ${flag}`;
  let summary = "";
  if (envelope.event === "feature.created") action = `Created ${flag}`;
  else if (envelope.event === "feature.deleted") action = `Deleted ${flag}`;
  else if (typeof previous.archived === "boolean") {
    action = `${object.archived ? "Archived" : "Unarchived"} ${flag}`;
  } else if (previous.revision !== undefined && version) {
    action = `Published ${flag} revision ${version}`;
    summary = comment.split("\n")[0].trim();
  }

  const current = featureState(object, environments);
  return {
    resourceType: "feature_flag",
    name: id,
    action,
    comment: summary,
    link: `${appOrigin}/features/${encodeURIComponent(id)}${version ? `?v=${version}` : ""}`,
    prevValue:
      envelope.event === "feature.created"
        ? undefined
        : envelope.event === "feature.deleted"
          ? current
          : featureState({ ...object, ...previous }, environments),
    newValue: envelope.event === "feature.deleted" ? undefined : current,
    metadata: {
      ...(version ? { revision: { version, comment } } : {}),
      project: asString(object.project),
      flag_tags: Array.isArray(object.tags) ? object.tags : [],
    },
  };
}

function experimentState(object: JsonRecord): JsonRecord {
  const phases = Array.isArray(object.phases) ? object.phases : [];
  const phase = asRecord(phases[phases.length - 1]);
  return {
    status: object.status,
    ...(phase.coverage !== undefined ? { coverage: phase.coverage } : {}),
    ...(phase.trafficSplit !== undefined
      ? { trafficSplit: phase.trafficSplit }
      : {}),
  };
}

function experimentChange(
  envelope: DatadogEnvelope,
  appOrigin: string,
): ChangeDetails {
  const object = eventObject(envelope);
  const previous = previousAttributes(envelope);
  const id = asString(object.id);
  const isBandit = object.type === "multi-armed-bandit";

  const name = asString(object.trackingKey) || id;
  const experiment = `${isBandit ? "Bandit" : "experiment"} ${name}`;
  let action = `Updated ${experiment}`;
  if (previous.status !== undefined) {
    action =
      object.status === "running"
        ? `Started ${experiment}`
        : object.status === "stopped"
          ? `Stopped ${experiment}`
          : object.status === "draft"
            ? `Moved ${experiment} to draft`
            : action;
  } else if (isBandit && previous.phases !== undefined) {
    action = `Reweighted ${experiment}`;
  }

  return {
    resourceType: "feature_flag",
    name,
    action,
    link: `${appOrigin}/${isBandit ? "bandit" : "experiment"}/${encodeURIComponent(id)}`,
    prevValue: experimentState({ ...object, ...previous }),
    newValue: experimentState(object),
    metadata: {
      experiment_id: id,
      experiment_name: asString(object.name),
      project: asString(object.project),
    },
  };
}

function savedGroupState(object: JsonRecord): JsonRecord {
  return {
    ...(object.condition ? { condition: object.condition } : {}),
    ...(object.attributeKey ? { attributeKey: object.attributeKey } : {}),
    ...(Array.isArray(object.values) ? { members: object.values.length } : {}),
  };
}

function configurationChange(
  envelope: DatadogEnvelope,
  appOrigin: string,
): ChangeDetails {
  const object = eventObject(envelope);
  const previous = previousAttributes(envelope);
  const id = asString(object.id);
  const deleted = envelope.event.endsWith(".deleted");
  const verb = deleted ? "Deleted" : "Updated";

  if (envelope.event.startsWith("savedGroup.")) {
    const current = savedGroupState(object);
    const name = asString(object.name) || id;
    return {
      resourceType: "configuration",
      name,
      action: `${verb} Saved Group ${name}`,
      link: `${appOrigin}/saved-groups/${encodeURIComponent(id)}`,
      prevValue: deleted
        ? current
        : savedGroupState({ ...object, ...previous }),
      newValue: deleted ? undefined : current,
      metadata: { saved_group_id: id },
    };
  }

  const isConfig = envelope.event.startsWith("config.");
  const name = asString(object.key) || asString(object.name) || id;
  return {
    resourceType: "configuration",
    name,
    action: `${verb} ${isConfig ? "Config" : "Constant"} ${name}`,
    link: `${appOrigin}/${isConfig ? "configs" : "constants"}/${encodeURIComponent(id)}`,
    metadata: { [isConfig ? "config_id" : "constant_id"]: id },
  };
}

export function buildDatadogChangeEvent({
  envelope,
  environments,
  service,
  appOrigin,
}: {
  envelope: DatadogEnvelope;
  environments: string[];
  service: string | null;
  appOrigin: string;
}): JsonRecord {
  const change = envelope.event.startsWith("feature.")
    ? featureChange(envelope, environments, appOrigin)
    : envelope.event === "experiment.updated"
      ? experimentChange(envelope, appOrigin)
      : configurationChange(envelope, appOrigin);

  const approvers = (envelope.approvers ?? [])
    .map((a) => a.name || a.email)
    .filter(Boolean);

  return changeEvent({
    title: truncate(
      `${change.action} in ${environments.join(", ")}${change.comment ? `: ${change.comment}` : ""}`,
      MAX_TITLE,
    ),
    timestamp: new Date(envelope.created).toISOString(),
    aggregation_key: aggregationKey(
      `growthbook:${envelope.event.split(".")[0]}:${asString(eventObject(envelope).id)}`,
    ),
    tags: [
      ...environments.map((env) => `env:${env}`),
      ...(service ? [`service:${service}`] : []),
    ].slice(0, MAX_TAGS),
    attributes: {
      changed_resource: {
        type: change.resourceType,
        name: truncate(change.name, MAX_NAME),
      },
      ...(service
        ? { impacted_resources: [{ type: "service", name: service }] }
        : {}),
      author: datadogAuthor(envelope.user),
      ...(change.prevValue ? { prev_value: change.prevValue } : {}),
      ...(change.newValue ? { new_value: change.newValue } : {}),
      change_metadata: {
        resource_link: change.link,
        ...change.metadata,
        ...(envelope.requestSource
          ? { request_source: envelope.requestSource }
          : {}),
        ...(envelope.relatedEntities?.length
          ? {
              related: envelope.relatedEntities.slice(0, MAX_RELATED),
              related_total: envelope.relatedEntities.length,
            }
          : {}),
        ...(approvers.length ? { approved_by: approvers } : {}),
      },
    },
  });
}

function buildDatadogTestEvent(
  envelope: Pick<DatadogEnvelope, "created" | "user">,
  service: string | null,
): JsonRecord {
  return changeEvent({
    title: "growthbook-test: Test event from GrowthBook",
    timestamp: new Date(envelope.created).toISOString(),
    aggregation_key: "growthbook:growthbook-test",
    // Datadog requires at least one tag.
    tags: ["growthbook-test", ...(service ? [`service:${service}`] : [])],
    attributes: {
      changed_resource: { type: "feature_flag", name: "growthbook-test" },
      ...(service
        ? { impacted_resources: [{ type: "service", name: service }] }
        : {}),
      author: datadogAuthor(envelope.user),
    },
  });
}

export function getDatadogNotificationPayload({
  event,
  eventWebHook,
}: {
  event: EventInterface;
  eventWebHook: Pick<
    EventWebHookInterface,
    "projects" | "tags" | "environments" | "datadog"
  >;
}): JsonRecord | null {
  if (!event.version) return null;
  const envelope: DatadogEnvelope = event.data;
  const service =
    eventWebHook.datadog?.service?.trim().toLowerCase().slice(0, MAX_NAME) ||
    null;
  if (envelope.event === "webhook.test") {
    return buildDatadogTestEvent(envelope, service);
  }
  if (!isDatadogEventWebHookEvent(envelope.event)) return null;
  // A results refresh changes nothing SDKs serve.
  if (isBookkeepingExperimentUpdate(event)) return null;

  // Nothing SDKs serve changed in the environments this webhook covers.
  const covered = webhookEventEnvironments(eventWebHook, envelope) ?? [];
  const environments = servedEnvironments(envelope).filter((e) =>
    covered.includes(e),
  );
  if (!environments.length) return null;

  return buildDatadogChangeEvent({
    envelope,
    environments,
    service,
    appOrigin: APP_ORIGIN,
  });
}
