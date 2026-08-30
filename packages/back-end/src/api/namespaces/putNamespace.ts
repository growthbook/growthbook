import { putNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "back-end/src/util/errors";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { buildNamespace } from "back-end/src/util/namespaces";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { orgNamespaceToApi } from "./namespaceApiUtils";

export const putNamespace = createApiRequestHandler(putNamespaceValidator)(
  async (req) => {
    if (!req.context.permissions.canUpdateNamespace()) {
      req.context.permissions.throwPermissionError();
    }

    const { displayName, description, status, hashAttribute } = req.body;
    const { id } = req.params;
    const { org } = req.context;
    const existing = org.settings?.namespaces ?? [];

    const target = existing.find((n) => n.name === id);
    if (!target) {
      throw new NotFoundError("Namespace not found.");
    }

    if (
      displayName &&
      displayName !== target.label &&
      existing.some((n) => n.name !== id && n.label === displayName)
    ) {
      throw new ConflictError(
        "A namespace with that display name already exists.",
      );
    }

    if (hashAttribute && target.format !== "multiRange") {
      throw new BadRequestError(
        "hashAttribute can only be set on multiRange namespaces.",
      );
    }

    const existingHashAttribute =
      target.format === "multiRange" ? target.hashAttribute : undefined;
    const existingSeed =
      target.format === "multiRange" ? target.seed : undefined;

    const updated = buildNamespace({
      name: target.name,
      label: displayName ?? target.label,
      description: description ?? target.description,
      status: status ?? target.status,
      format: target.format ?? "legacy",
      hashAttribute: hashAttribute ?? existingHashAttribute,
      existingHashAttribute,
      existingSeed,
    });

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
  },
);
