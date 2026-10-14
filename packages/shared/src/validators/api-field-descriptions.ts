import { MAX_SAVED_GROUP_DESCRIPTION_LENGTH } from "shared/constants";

// OpenAPI descriptions for human-facing fields. They tell API clients (and AI
// agents) what belongs in a short name or key versus a description.

export const MARKDOWN_DESCRIPTION =
  "Markdown. Put context here, not in the name.";

export const TAGS_DESCRIPTION =
  "Tags for filtering and grouping. Use these instead of encoding groups in names.";

export const FEATURE_KEY_DESCRIPTION =
  "Permanent key, shown as the Feature Flag's name in the UI and used in code. Keep it short and follow your organization's key format if it has one, otherwise kebab-case (e.g. `checkout-express-pay`). Put context in `description`.";

export const FEATURE_DESCRIPTION =
  "Markdown. What the Feature Flag gates and why, rollout plan, and links. Put context here, not in the key.";

export const RULE_DESCRIPTION =
  "Short note on why the rule exists (e.g. `Beta testers only`).";

export const EXPERIMENT_NAME_DESCRIPTION =
  "Short display name (e.g. `Express checkout button`). Put reasoning in `hypothesis` and context in `description`.";

export const EXPERIMENT_TRACKING_KEY_DESCRIPTION =
  "Key sent with exposure events. Keep it short and follow your organization's tracking key format if it has one, otherwise kebab-case (usually the Feature Flag key). Changing it after launch splits exposures across two keys.";

export const EXPERIMENT_HYPOTHESIS_DESCRIPTION =
  "Markdown. If we change X, metric Y will move because Z.";

export const VARIATION_KEY_DESCRIPTION =
  "Key sent with exposure events (e.g. `0`, `1`). Changing it after launch splits exposures.";

export const VARIATION_NAME_DESCRIPTION =
  "Short label shown in results (e.g. `Control`).";

export const VARIATION_DESCRIPTION = "What this variation changes.";

export const METRIC_NAME_DESCRIPTION =
  "Short display name (e.g. `Purchases per user`). Put the definition in `description`.";

export const SAVED_GROUP_NAME_DESCRIPTION =
  "Short display name (e.g. `Internal employees`). Put details in `description`.";

export const SAVED_GROUP_DESCRIPTION = `Short note (max ${MAX_SAVED_GROUP_DESCRIPTION_LENGTH} characters) on who is in the Saved Group and why.`;

export const GENERIC_NAME_DESCRIPTION =
  "Short display name. Put details in `description`.";

export const PLAIN_DESCRIPTION = "Put context here, not in the name.";

export const REVISION_TITLE_DESCRIPTION =
  "Short draft title (e.g. `Enable for beta testers`).";

export const REVISION_COMMENT_DESCRIPTION =
  "Markdown. What changed and why, for reviewers.";

export const NEW_DRAFT_TITLE_DESCRIPTION = `${REVISION_TITLE_DESCRIPTION} Only used when \`version\` is "new"; ignored for existing drafts.`;

export const NEW_DRAFT_COMMENT_DESCRIPTION = `${REVISION_COMMENT_DESCRIPTION} Only used when \`version\` is "new"; ignored for existing drafts.`;

export const REQUEST_REVIEW_COMMENT_DESCRIPTION =
  "Markdown. What changed and why, for reviewers. Replaces the draft's comment; leaving it out clears it.";

export const PUBLISH_COMMENT_DESCRIPTION =
  "Note recorded in the revision history for this publish. Becomes the draft's comment only if the draft has none.";

export const PROJECTS_DESCRIPTION =
  "Project IDs. Use Projects instead of prefixing names.";

export const ENVIRONMENT_PROJECTS_DESCRIPTION =
  "Limits which Projects can use this environment. Omit to allow all Projects.";

export const ENVIRONMENT_PROJECTS_UPDATE_DESCRIPTION =
  "Limits which Projects can use this environment. Omit to keep the current list; send `[]` to allow all Projects.";

export const REVIEW_COMMENT_DESCRIPTION =
  "Markdown. Why you approved or requested changes.";
