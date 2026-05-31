import type { ApiReqContext } from "back-end/types/api";

// Guard used by every visual-editor-ai endpoint to require that the
// caller authenticated as a real user — i.e. via a Personal Access
// Token (PAT) — rather than an organization-level secret API key.
//
// Why this exists:
//   - context.userId is populated by authenticateApiRequestMiddleware
//     only when the Bearer token's API key record has a `userId` field
//     attached (the PAT case). Org-level secret keys leave it empty.
//   - Without a user identity, audit events fall back to the API key
//     description (so the audit log says "api_key: visual-editor-key"
//     instead of "alice@company.com"), per-user / project-scoped
//     permissions are bypassed (an admin-role org key passes every
//     canUpdateVisualChange / canCreateExperiment check), and any
//     persisted owner / creator field becomes empty.
//   - For the visual editor specifically — where multiple users share
//     an org and we want clear attribution of "who edited what" — none
//     of those failure modes are acceptable.
//
// We apply this universally to the visual-editor surface (not just
// writes) so the failure mode is consistent: org-key callers get a
// clear error at the first request rather than partway through a
// create flow. Once the connect-extension PAT-provisioning UX lands,
// this same gate will route those keys to the right place automatically.
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
