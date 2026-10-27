import isEqual from "lodash/isEqual";
import { putApiKeyRolesValidator } from "shared/validators";
import { apiKeyRolesRefusal, changesApiKeyAuthority } from "shared/permissions";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { ApiKeyModel } from "back-end/src/models/ApiKeyModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { requireConfirmation } from "back-end/src/services/confirmations";
import { toApiKeys } from "./toApiKey";

export const putApiKeyRoles = createApiRequestHandler(putApiKeyRolesValidator)(
  async (req) => {
    const { context } = req;
    const { dryRun, actAs, ...roles } = req.body;

    // Changing a key's roles changes its authority, which also takes create.
    if (
      !context.permissions.canUpdateApiKey() ||
      !context.permissions.canCreateApiKey()
    ) {
      context.permissions.throwPermissionError(
        "You do not have permission to change API keys' roles. This needs permission to edit and create API keys.",
      );
    }

    const key = await context.models.apiKeys.getSecretApiKeyById(req.params.id);
    if (!key) {
      throw new NotFoundError(
        "Could not find an organization API key with that id",
      );
    }
    if (key.userId) {
      throw new BadRequestError(
        "That id is a personal access token. Only organization API keys' roles can be changed here.",
      );
    }
    if (key.id === context.apiKeyData?.id) {
      context.permissions.throwPermissionError(
        "An API key can't change its own roles. Use a different key or the GrowthBook dashboard.",
      );
    }

    const refusal = apiKeyRolesRefusal(roles, context.org);
    if (refusal) throw new BadRequestError(refusal);

    const updates = { ...roles, ...(actAs !== undefined && { actAs }) };
    // The body is the key's whole role set, so its environment list is synced
    // even while the limit is off, when it grants nothing.
    const sameEnvironments = isEqual(
      [...key.environments].sort(),
      [...roles.environments].sort(),
    );
    if (
      sameEnvironments &&
      !changesApiKeyAuthority(key, { ...key, ...updates })
    ) {
      const [apiKey] = await toApiKeys(context, [key]);
      return { apiKey, changed: false };
    }

    const fields = { ...updates, description: key.description };
    if (dryRun) {
      const { after } =
        await context.models.apiKeys.updateSecretApiKeyPermissions(
          req.params.id,
          fields,
          { dryRun: true },
        );
      const [apiKey] = await toApiKeys(context, [after]);
      return { apiKey, changed: true };
    }

    await requireConfirmation(context, {
      actions: ["access.apiKeys"],
      summary: `Change the roles of API key ${key.description || key.id}`,
      links: [],
      pin: key.dateUpdated,
    });

    const { before, after } =
      await context.models.apiKeys.updateSecretApiKeyPermissions(
        req.params.id,
        fields,
      );

    await req.audit({
      event: "apiKey.update",
      entity: { object: "apiKey", id: after.id ?? "", name: after.description },
      details: auditDetailsUpdate(
        ApiKeyModel.toAuditDetails(before),
        ApiKeyModel.toAuditDetails(after),
      ),
    });

    const [apiKey] = await toApiKeys(context, [after]);
    return { apiKey, changed: true };
  },
);
