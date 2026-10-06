import { getFeatureRevisionLogV2Validator } from "shared/validators";
import { getValidDate } from "shared/dates";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { eventUserToApi } from "back-end/src/api/revisionApiEnvelope";
import { NotFoundError } from "back-end/src/util/errors";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";

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
      user: eventUserToApi(entry.user),
    })),
  };
});
