import { OrganizationInterface } from "../../types/organization";
import { ApiKeyInterface } from "../../types/apikey";

/**
 * Verifies if the provided API key is for a user in the organization.
 * We need to use a {@link Partial<ApiKeyInterface>} so if it is incomplete, i.e. does not have userId,
 * then it will return false as we are expecting this property.
 */
export const isApiKeyForUserInOrganization = (
  { userId }: Partial<ApiKeyInterface>,
  organization: Partial<OrganizationInterface>
): boolean => {
  if (!userId) return false;

  // Cannot verify because organization has no members
  if (!organization.members) return false;

  return !!organization.members.find((m) => m.id === userId);
};

export const roleForApiKey = (
  apiKey: Pick<ApiKeyInterface, "role" | "userId" | "secret">
): "readonly" | "admin" | null => {
  // This role stuff is only for secret keys, not SDK keys
  if (!apiKey.secret) return null;

  // The role will need to be evaluated
  if (apiKey.userId) return null;

  // Read-only keys have an explicit role assignment of read-only
  if (apiKey.role === "readonly") return "readonly";

  if (apiKey.role) {
    // If there's another role type that isn't handled here, throw.
    throw new Error("Unknown/unsupported role");
  }

  return "admin";
};
