import uniqid from "uniqid";
import { PostNamespaceResponse } from "shared/types/openapi";
import { postNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsCreate } from "back-end/src/services/audit";

export const postNamespace = createApiRequestHandler(postNamespaceValidator)(
  async (req): Promise<PostNamespaceResponse> => {
    const { label, description, status } = req.body;

    if (!req.context.permissions.canCreateNamespace()) {
      req.context.permissions.throwPermissionError();
    }

    const org = req.context.org;
    const namespaces = org.settings?.namespaces || [];

    if (namespaces.some((n) => n.label === label)) {
      throw new Error("A namespace with this name already exists.");
    }

    const name = uniqid("ns-");
    const namespace = { name, label, description, status };

    await updateOrganization(org.id, {
      settings: {
        ...org.settings,
        namespaces: [...namespaces, namespace],
      },
    });

    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: org.id,
      },
      details: auditDetailsCreate(namespace),
    });

    return {
      namespace,
    };
  },
);
