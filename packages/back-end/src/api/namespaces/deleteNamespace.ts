import { experimentHasLinkedChanges } from "shared/util";
import { deleteNamespaceValidator } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";

async function hasActiveMembers(id: string, context: ApiReqContext) {
  const { environments } = context;

  const features = await getAllFeatures(context);
  for (const f of features) {
    if (f.archived) continue;
    for (const env of environments) {
      if (!f.environmentSettings?.[env]?.enabled) continue;
      const rules = f.environmentSettings?.[env]?.rules ?? [];
      if (
        rules.some(
          (r) =>
            r.enabled &&
            r.type === "experiment" &&
            r.namespace?.enabled &&
            r.namespace.name === id,
        )
      ) {
        return true;
      }
    }
  }

  const experiments = await getAllExperiments(context);
  for (const e of experiments) {
    if (e.archived) continue;
    if (!experimentHasLinkedChanges(e)) continue;
    if (
      e.status === "stopped" &&
      (e.excludeFromPayload || !e.releasedVariationId)
    )
      continue;
    if (!e.phases?.length) continue;
    const phase = e.phases[e.phases.length - 1];
    if (phase?.namespace?.enabled && phase.namespace.name === id) return true;
  }

  return false;
}

export const deleteNamespace = createApiRequestHandler(
  deleteNamespaceValidator,
)(async (req) => {
  if (!req.context.permissions.canDeleteNamespace()) {
    req.context.permissions.throwPermissionError();
  }

  const { id } = req.params;
  const { org } = req.context;
  const existing = org.settings?.namespaces ?? [];

  const updated = existing.filter((n) => n.name !== id);
  if (updated.length === existing.length) {
    throw new Error("Namespace not found.");
  }

  if (await hasActiveMembers(id, req.context)) {
    throw new Error(
      "Cannot delete a namespace that is actively used by experiments or feature rules. Disable or remove those references first.",
    );
  }

  await updateOrganization(org.id, {
    settings: { ...org.settings, namespaces: updated },
  });

  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      { settings: { namespaces: existing } },
      { settings: { namespaces: updated } },
    ),
  });

  return { deletedId: id };
});
