import type { ApiReqContext } from "back-end/types/api";

// Reject org-level API keys: every visual-editor endpoint requires a
// Personal Access Token so edits are attributable to a user (audit
// log + per-user permissions). context.userId is only populated by
// the auth middleware when the Bearer token has a userId attached.
export function requireUserAuth(context: ApiReqContext): void {
  if (!context.userId) {
    throw new Error(
      "The visual editor requires a Personal Access Token (PAT). " +
        "Organization-level API keys aren't supported because edits need to be attributed to a real user " +
        "(for audit trails and per-user permissions). " +
        "Generate a Personal Access Token from your GrowthBook user profile and re-connect the extension.",
    );
  }
}
