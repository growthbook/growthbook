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

const OWNER_PERSON_DEFAULT =
  "the person making the request: a personal access token's owner, or the member an organization API key names with `X-GrowthBook-Requested-By`";

/**
 * Optional owner input for create endpoints. When omitted, the owner defaults to
 * the person behind the request, or stays empty for a key that names no one.
 */
export const optionalOwnerInputField = ownerInputField
  .optional()
  .describe(
    `The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization. When omitted, it defaults to ${OWNER_PERSON_DEFAULT}. An organization API key that names no one leaves it empty.`,
  );

/**
 * For create endpoints that must end up with an owner (resolveOwnerForCreate):
 * the same default, but a request with no person behind it is rejected.
 */
export const requiredUnlessPersonOwnerInputField =
  optionalOwnerInputField.describe(
    `The userId or email address of the owner. If an email address is provided, it will be used to look up the userId of the matching organization member. If an ID is provided, it will be validated as existing in the organization. When omitted, it defaults to ${OWNER_PERSON_DEFAULT}. An organization API key that names no one must send it, or the request fails with a 400.`,
  );
