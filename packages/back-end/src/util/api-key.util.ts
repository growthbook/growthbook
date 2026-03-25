import { webcrypto } from "node:crypto";
import crypto from "crypto";
import { OrganizationInterface } from "shared/types/organization";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  IS_MULTI_ORG,
  SECRET_API_KEY,
  SECRET_API_KEY_ROLE,
} from "back-end/src/util/secrets";
import {
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";
import { findAllOrganizations } from "back-end/src/models/OrganizationModel";
import { COLLECTION_NAME as API_KEY_COLLECTION } from "back-end/src/models/ApiKeyModel";

/**
 * Verifies if the provided API key is for a user in the organization.
 * We need to use a {@link Partial<ApiKeyInterface>} so if it is incomplete, i.e. does not have userId,
 * then it will return false as we are expecting this property.
 */
export const isApiKeyForUserInOrganization = (
  { userId }: Partial<ApiKeyInterface>,
  organization: Partial<OrganizationInterface>,
): boolean => {
  if (!userId) return false;

  // Cannot verify because organization has no members
  if (!organization.members) return false;

  return !!organization.members.find((m) => m.id === userId);
};

export const roleForApiKey = (
  apiKey: Pick<ApiKeyInterface, "role" | "userId" | "secret">,
): string | null => {
  // This role stuff is only for secret keys, not SDK keys
  if (!apiKey.secret) return null;

  // The role will need to be evaluated
  if (apiKey.userId) return null;

  // If there's a role assigned, return that
  if (apiKey.role) return apiKey.role;

  // At this stage, we assume it's a secret key with full organizational access, like the initial secret API keys
  return "admin";
};

export async function generateEncryptionKey(): Promise<string> {
  const key = await webcrypto.subtle.generateKey(
    {
      name: "AES-CBC",
      length: 128,
    },
    true,
    ["encrypt", "decrypt"],
  );
  return Buffer.from(await webcrypto.subtle.exportKey("raw", key)).toString(
    "base64",
  );
}

export function generateSigningKey(prefix: string = "", bytes = 32): string {
  return (
    prefix + crypto.randomBytes(bytes).toString("base64").replace(/[=/+]/g, "")
  );
}

export function migrateApiKey(legacyDoc: unknown) {
  const obj = legacyDoc as ApiKeyInterface;
  return {
    ...obj,
    role: roleForApiKey(obj) || undefined,
    dateUpdated: obj.dateUpdated ?? obj.dateCreated,
    limitAccessByEnvironment: obj.limitAccessByEnvironment ?? false,
    environments: obj.environments ?? [],
    projectRoles: obj.projectRoles ?? [],
    teams: obj.teams ?? [],
  };
}

// Cross-organization DB operation, lives outside of ApiKeyModel due to a circular dependency with auth middleware
export async function dangerousLookupOrganizationByApiKey(
  key: string,
): Promise<ApiKeyInterface> {
  // If self-hosting on a single org and using a hardcoded secret key
  if (!IS_MULTI_ORG && SECRET_API_KEY && key === SECRET_API_KEY) {
    const { organizations: orgs } = await findAllOrganizations(1, "");
    if (orgs.length === 1) {
      return migrateApiKey({
        id: "SECRET_API_KEY",
        key: SECRET_API_KEY,
        secret: true,
        organization: orgs[0].id,
        role: SECRET_API_KEY_ROLE,
        dateCreated: new Date(),
      });
    }
  }

  const doc = await getCollection<ApiKeyInterface>(API_KEY_COLLECTION).findOne({
    key,
  });

  if (!doc || !doc.organization) {
    throw new Error("Invalid API key");
  }

  return migrateApiKey(removeMongooseFields(doc));
}
