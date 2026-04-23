import uniqid from "uniqid";
import { postNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, ConflictError } from "back-end/src/util/errors";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { buildNamespace } from "back-end/src/util/namespaces";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { orgNamespaceToApi } from "./namespaceApiUtils";

export const postNamespace = createApiRequestHandler(postNamespaceValidator)(
  async (req) => {
    if (!req.context.permissions.canCreateNamespace()) {
      req.context.permissions.throwPermissionError();
    }

    const { displayName, description, status, format, hashAttribute } =
      req.body;

    const { org } = req.context;
    const existing = org.settings?.namespaces ?? [];

    if (existing.some((n) => n.label === displayName)) {
      throw new ConflictError(
        "A namespace with that display name already exists.",
      );
    }

    const effectiveFormat = format ?? "multiRange";
    if (effectiveFormat === "multiRange" && !hashAttribute) {
      throw new BadRequestError(
        "hashAttribute is required when format is 'multiRange'. Provide a user attribute (e.g. 'id') to use for namespace bucket assignment.",
      );
    }

    const newNamespace = buildNamespace({
      name: uniqid("ns-"),
      label: displayName,
      description: description ?? "",
      status: status ?? "active",
      format: effectiveFormat,
      hashAttribute,
    });

    const updated = [...existing, newNamespace];
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

    return { namespace: orgNamespaceToApi(newNamespace) };
  },
);
