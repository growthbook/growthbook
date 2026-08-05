import { z } from "zod";

/**
 * Zod equivalent of OwnerField.yaml — use on API response schemas.
 */
export const ownerField = z
  .string()
  .describe(
    "The userId of the owner (or raw owner name/email for legacy records)",
  );

/**
 * Resolved email address for the owner, populated on API responses.
 * Optional — undefined when the owner cannot be resolved to a known user.
 */
export const ownerEmailField = z
  .string()
  .optional()
  .describe(
    "The email address of the owner, when the owner can be resolved to a known user.",
  );

/**
 * Zod equivalent of OwnerInputField.yaml — use on API request/input schemas.
 * Chain .optional() if the field is not required.
 */
export const ownerInputField = z
  .string()
  .describe(
    "The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization.",
  );

/**
 * Optional owner input for create endpoints. When omitted, the owner defaults to
 * the user associated with the request's Personal Access Token (PAT), if one is
 * being used.
 */
export const optionalOwnerInputField = ownerInputField
  .optional()
  .describe(
    "The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization. When omitted, it defaults to the user associated with the request's Personal Access Token (PAT), if one is being used.",
  );

/**
 * For create endpoints that must end up with an owner (resolveOwnerForCreate):
 * same PAT default, but an organization secret API key has no associated user,
 * so omitting the field with one is rejected.
 */
export const requiredUnlessPatOwnerInputField =
  optionalOwnerInputField.describe(
    "The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization. Optional when authenticating with a Personal Access Token (PAT): when omitted, the owner defaults to the PAT's user. Required when authenticating with an organization secret API key (which has no associated user): omitting it fails with a 400.",
  );
