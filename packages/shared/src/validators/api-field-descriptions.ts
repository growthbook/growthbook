import { MAX_SAVED_GROUP_DESCRIPTION_LENGTH } from "shared/constants";

// OpenAPI descriptions for human-facing fields. They tell API clients (and AI
// agents) what belongs in a short name or key versus a description.

export const MARKDOWN_DESCRIPTION =
  "Markdown. Put context here, not in the name.";

export const TAGS_DESCRIPTION =
  "Tags for filtering and grouping. Use these instead of encoding groups in names.";

export const FEATURE_KEY_DESCRIPTION =
  "Unique, permanent key, shown as the Feature Flag's name in the UI and used in code. Keep it short. If `featureRegexValidator` in `GET /api/v1/settings` is set, follow it (`featureKeyExample` shows the format); otherwise use kebab-case (e.g. `checkout-express-pay`). Put context in `description`.";

export const FEATURE_DESCRIPTION =
  "Markdown. What the Feature Flag gates and why, rollout plan, and links. Put context here, not in the key.";

export const RULE_DESCRIPTION =
  "Short note on why the rule exists (e.g. `Beta testers only`).";

export const FALLBACK_ATTRIBUTE_DESCRIPTION =
  "Used in place of `hashAttribute` when a user lacks it. Only SDKs with Sticky Bucketing enabled use it.";

export const EXPERIMENT_NAME_DESCRIPTION =
  "Short display name (e.g. `Express checkout button`). Put reasoning in `hypothesis` and context in `description`.";

export const EXPERIMENT_TRACKING_KEY_DESCRIPTION =
  "Key sent with exposure events. Keep it short, in kebab-case (usually the Feature Flag key). If your organization requires a tracking key format, a key that doesn't match is rejected with `invalid_tracking_key`. Changing it after launch splits exposures across two keys.";

export const EXPERIMENT_HYPOTHESIS_DESCRIPTION =
  "Markdown. If we change X, metric Y will move because Z.";

export const BANDIT_TRACKING_KEY_DESCRIPTION =
  "Key sent with exposure events. Keep it short, in kebab-case. Changing it after launch splits exposures across two keys.";

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
  "Note recorded in the audit log for this publish. Also becomes the draft's comment if the draft has none; otherwise the existing draft comment is kept.";

export const REVERT_COMMENT_IGNORED_DESCRIPTION =
  "Currently ignored. Use `title` to describe the revert.";

export const PROJECTS_DESCRIPTION =
  "Project IDs that can use this. An empty list means all Projects. Projects control access and availability, so don't use them as labels.";

export const ENVIRONMENT_PROJECTS_DESCRIPTION =
  "Limits which Projects can use this environment. Omit to allow all Projects.";

export const ENVIRONMENT_PROJECTS_UPDATE_DESCRIPTION =
  "Limits which Projects can use this environment. Omit to keep the current list; send `[]` to allow all Projects.";

export const REVIEW_COMMENT_DESCRIPTION =
  "Markdown. Why you approved, requested changes or commented.";

export const REVIEW_ACTION_DESCRIPTION =
  "`approve`, `request-changes` or `comment`. Defaults to `comment`, which doesn't change whether the draft is approved.";

export const ATTRIBUTE_PROPERTY_DESCRIPTION =
  "Attribute name exactly as your SDK passes it (e.g. `userId`). The API can't rename it, and renaming it in the UI doesn't update SDK code or targeting conditions.";
