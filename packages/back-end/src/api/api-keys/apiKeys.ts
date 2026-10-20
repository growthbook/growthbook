import {
  deleteApiKeyValidator,
  listApiKeysValidator,
  postApiKeyDisableValidator,
  postApiKeyEnableValidator,
} from "shared/validators";
import { ApiKeyInterface } from "shared/types/apikey";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import {
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

// SDK keys belong to SDK Connections; PATs and OAuth tokens to their users.
function isOrgSecretKey(key: ApiKeyInterface) {
  return !!key.secret && !key.userId && !key.oauthClientId;
}

function toApiApiKey(key: ApiKeyInterface) {
  return {
    id: key.id || "",
    description: key.description || "",
    role: key.role || "admin",
    limitAccessByEnvironment: key.limitAccessByEnvironment,
    environments: key.environments,
    additionalRoles: key.additionalRoles,
    projectRoles: key.projectRoles,
    disabled: !!key.disabled,
    lastUsed: key.lastUsed?.toISOString() ?? null,
    dateCreated: key.dateCreated.toISOString(),
  };
}

async function getOrgSecretKey(context: ApiReqContext, id: string) {
  const key = await context.models.apiKeys.getById(id);
  if (!key || !isOrgSecretKey(key)) {
    context.throwNotFoundError(`API key not found: ${id}`);
  }
  return key;
}

async function setDisabled(
  req: Pick<ApiRequestLocals, "audit" | "context">,
  id: string,
  disabled: boolean,
) {
  // Disabling takes Disable & delete; re-enabling restores access, so Edit
  if (
    disabled
      ? !req.context.permissions.canDeleteApiKey()
      : !req.context.permissions.canUpdateApiKey()
  ) {
    req.context.permissions.throwPermissionError();
  }
  await getOrgSecretKey(req.context, id);
  const { before, after } = await req.context.models.apiKeys.setDisabled(
    id,
    disabled,
  );
  await req.audit({
    event: disabled ? "apiKey.disable" : "apiKey.enable",
    entity: { object: "apiKey", id, name: after.description },
    details: auditDetailsUpdate(
      ApiKeyModel.toAuditDetails(before),
      ApiKeyModel.toAuditDetails(after),
    ),
  });
  return { apiKey: toApiApiKey(after) };
}

export const listApiKeys = createApiRequestHandler(listApiKeysValidator)(async (
  req,
) => {
  if (!req.context.permissions.canViewApiKeys()) {
    req.context.permissions.throwPermissionError();
  }
  const keys = await req.context.models.apiKeys.getAll();
  return { apiKeys: keys.filter(isOrgSecretKey).map(toApiApiKey) };
});

export const postApiKeyDisable = createApiRequestHandler(
  postApiKeyDisableValidator,
)((req) => setDisabled(req, req.params.id, true));

export const postApiKeyEnable = createApiRequestHandler(
  postApiKeyEnableValidator,
)((req) => setDisabled(req, req.params.id, false));

export const deleteApiKey = createApiRequestHandler(deleteApiKeyValidator)(
  async (req) => {
    if (!req.context.permissions.canDeleteApiKey()) {
      req.context.permissions.throwPermissionError();
    }
    await getOrgSecretKey(req.context, req.params.id);
    const deleted = await req.context.models.apiKeys.deleteByIdOrKey(
      req.params.id,
      undefined,
    );
    await req.audit({
      event: "apiKey.delete",
      entity: {
        object: "apiKey",
        id: req.params.id,
        name: deleted.description,
      },
      details: auditDetailsDelete(ApiKeyModel.toAuditDetails(deleted)),
    });
    return { deletedId: req.params.id };
  },
);
