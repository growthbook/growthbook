import { webcrypto } from "node:crypto";
import crypto from "crypto";
import { OrganizationInterface } from "shared/types/organization";
import { ApiKeyInterface } from "shared/types/apikey";
import type { RequestedByPolicy } from "shared/validators";
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
import {
  hashToken,
  OAUTH_ACCESS_TOKEN_PREFIX,
} from "back-end/src/util/oauth-token.util";

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

  // OAuth access tokens are stored hashed under a distinguishing prefix.
  // Hash-then-lookup only for that prefix so classic keys stay plaintext.
  const lookupKey = key.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)
    ? hashToken(key)
    : key;

  const doc = await getCollection<ApiKeyInterface>(API_KEY_COLLECTION).findOne({
    key: lookupKey,
  });

  if (!doc || !doc.organization) {
    throw new Error("Invalid API key");
  }

  const migrated = migrateApiKey(removeMongooseFields(doc));

  if (migrated.expiresAt && migrated.expiresAt.getTime() <= Date.now()) {
    throw new Error("This API key has expired");
  }

  return migrated;
}

export const REQUESTED_BY_HEADER = "x-requested-by";

export type RequestedByMember = { id: string; name: string; email: string };

type MemberLookup = {
  byId: (
    id: string,
  ) => Promise<{ id: string; name?: string; email: string } | null>;
  byEmail: (
    email: string,
  ) => Promise<{ id: string; name?: string; email: string } | null>;
};

// Carries the status the auth middleware answers with.
export class RequestedByError extends Error {
  constructor(
    public readonly status: 400 | 403,
    message: string,
  ) {
    super(message);
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  const first = (Array.isArray(value) ? value[0] : value)?.trim();
  return first || null;
}

// Resolves `X-Requested-By` to an organization member by user id, then email.
// Null when the header is absent. Throws when it names nobody in the
// organization, so attribution never silently falls back to the key alone.
export async function resolveRequestedBy(
  value: string | string[] | undefined,
  organization: Pick<OrganizationInterface, "members">,
  lookup: MemberLookup,
): Promise<RequestedByMember | null> {
  const named = headerValue(value);
  if (!named) return null;

  const memberIds = new Set((organization.members ?? []).map((m) => m.id));
  const user = memberIds.has(named)
    ? await lookup.byId(named)
    : await lookup.byEmail(named);
  if (!user || !memberIds.has(user.id)) {
    throw new RequestedByError(
      400,
      `X-Requested-By does not match a member of this organization: ${named}`,
    );
  }
  return { id: user.id, name: user.name || "", email: user.email };
}

// The key's own settings decide whether a request may, or must, name a member.
export function assertRequestedByAllowed(
  policy: RequestedByPolicy,
  member: RequestedByMember | null,
): void {
  if (!member) {
    if (policy.mode === "required") {
      throw new RequestedByError(
        400,
        "This API key requires an X-Requested-By header naming an organization member",
      );
    }
    return;
  }
  if (policy.mode === "off") {
    throw new RequestedByError(
      403,
      "This API key does not accept X-Requested-By",
    );
  }
}

// Personal access and OAuth tokens already act as their owner.
export function assertNoRequestedByOnUserToken(
  value: string | string[] | undefined,
): void {
  if (headerValue(value)) {
    throw new RequestedByError(
      400,
      "X-Requested-By is only for organization API keys. Personal access tokens already act as their owner.",
    );
  }
}
