import { getFeatureRevisionLogV2Validator } from "shared/validators";
import { EventUser } from "shared/types/events/event-types";
import { getValidDate } from "shared/dates";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

// Strip secrets (API key strings) from the log actor before returning it.
function sanitizeLogUser(user: EventUser): {
  type: "dashboard" | "api_key" | "system";
  id?: string;
  name?: string;
  email?: string;
} | null {
  if (!user) return null;
  switch (user.type) {
    case "dashboard":
      return {
        type: "dashboard",
        id: user.id,
        name: user.name,
        email: user.email,
      };
    case "api_key":
      return {
        type: "api_key",
        ...(user.id !== undefined ? { id: user.id } : {}),
        ...(user.name !== undefined ? { name: user.name } : {}),
        ...(user.email !== undefined ? { email: user.email } : {}),
      };
    case "system":
      return {
        type: "system",
        ...(user.id !== undefined ? { id: user.id } : {}),
      };
  }
}

export const getFeatureRevisionLogV2 = createApiRequestHandler(
  getFeatureRevisionLogV2Validator,
)(async (req) => {
  const feature = await getFeature(req.context, req.params.id);
  if (!feature) throw new NotFoundError("Could not find feature");

  // Legacy log entries were stored inline on the revision document
  const revision = await getRevision({
    context: req.context,
    organization: req.organization.id,
    featureId: feature.id,
    feature,
    version: req.params.version,
    includeLog: true,
  });
  if (!revision) throw new NotFoundError("Could not find feature revision");

  // New entries live in their own collection (they are too large to inline)
  const revisionLogs =
    await req.context.models.featureRevisionLogs.getAllByFeatureIdAndVersion({
      featureId: feature.id,
      version: req.params.version,
    });

  const merged = [
    ...(revision.log ?? []).map((entry) => ({
      timestamp: entry.timestamp,
      user: entry.user,
      action: entry.action,
      subject: entry.subject,
      value: entry.value,
    })),
    ...revisionLogs.map((entry) => ({
      id: entry.id,
      timestamp: entry.dateCreated,
      user: entry.user,
      action: entry.action,
      subject: entry.subject,
      value: entry.value,
    })),
  ];

  merged.sort(
    (a, b) =>
      getValidDate(a.timestamp).getTime() - getValidDate(b.timestamp).getTime(),
  );

  return {
    log: merged.map((entry) => ({
      ...entry,
      timestamp: getValidDate(entry.timestamp).toISOString(),
      user: sanitizeLogUser(entry.user),
    })),
  };
});
