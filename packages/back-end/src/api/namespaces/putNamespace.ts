import { PutNamespaceResponse } from "shared/types/openapi";
import { putNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export const putNamespace = createApiRequestHandler(putNamespaceValidator)(
  async (req): Promise<PutNamespaceResponse> => {
    const { label, description, status } = req.body;
    const { id } = req.params;

    if (!req.context.permissions.canUpdateNamespace()) {
      req.context.permissions.throwPermissionError();
    }

    const org = req.context.org;
    const namespaces = org.settings?.namespaces || [];

    const existingIndex = namespaces.findIndex((n) => n.name === id);
    if (existingIndex === -1) {
      throw new Error("Namespace not found.");
    }

    const existing = namespaces[existingIndex];
    const updatedNamespace = {
      ...existing,
      label,
      description,
      status,
    };

    const updatedNamespaces = [...namespaces];
    updatedNamespaces[existingIndex] = updatedNamespace;

    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        namespaces: updatedNamespaces,
      },
    });

    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsUpdate(existing, updatedNamespace),
    });

    return {
      namespace: updatedNamespace,
    };
  },
);
