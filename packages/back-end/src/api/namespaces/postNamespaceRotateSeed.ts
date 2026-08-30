import { v4 as uuidv4 } from "uuid";
import { postNamespaceRotateSeedValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { orgNamespaceToApi } from "./namespaceApiUtils";

export const postNamespaceRotateSeed = createApiRequestHandler(
  postNamespaceRotateSeedValidator,
)(async (req) => {
  if (!req.context.permissions.canUpdateNamespace()) {
    req.context.permissions.throwPermissionError();
  }

  const { id } = req.params;
  const { org } = req.context;
  const existing = org.settings?.namespaces ?? [];

  const target = existing.find((n) => n.name === id);
  if (!target) {
    throw new NotFoundError("Namespace not found.");
  }

  if (target.format !== "multiRange") {
    throw new BadRequestError(
      "Seed rotation only applies to multiRange namespaces. Legacy namespaces do not use a seed.",
    );
  }

  const updated = { ...target, seed: req.body.seed ?? uuidv4() };
  const updatedList = existing.map((n) => (n.name === id ? updated : n));

  await updateOrganization(org.id, {
    settings: { ...org.settings, namespaces: updatedList },
  });

  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      { settings: { namespaces: existing } },
      { settings: { namespaces: updatedList } },
    ),
  });

  return { namespace: orgNamespaceToApi(updated) };
});
