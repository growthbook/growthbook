// OpenAPI descriptions for human-facing fields. They tell API clients (and AI
// agents) what belongs in a short name or key versus a description.

export const MARKDOWN_DESCRIPTION =
  "Markdown. Put context here, not in the name.";

export const TAGS_DESCRIPTION =
  "Tags for filtering and grouping. Use these instead of encoding groups in names.";

export const FEATURE_KEY_DESCRIPTION =
  "Permanent key, shown as the feature's name in the UI and used in code. Keep it short and follow your organization's key format if it has one, otherwise kebab-case (e.g. `checkout-express-pay`). Put context in `description`.";

export const FEATURE_DESCRIPTION =
  "Markdown. What the flag gates and why, rollout plan, and links. Put context here, not in the key.";

export const RULE_DESCRIPTION =
  "Short note on why the rule exists (e.g. `Beta testers only`).";

export const EXPERIMENT_NAME_DESCRIPTION =
  "Short display name (e.g. `Express checkout button`). Put reasoning in `hypothesis` and context in `description`.";

export const EXPERIMENT_TRACKING_KEY_DESCRIPTION =
  "Stable key sent with exposure events. Short kebab-case, usually the feature key. Don't change after launch.";

export const EXPERIMENT_HYPOTHESIS_DESCRIPTION =
  "Markdown. If we change X, metric Y will move because Z.";

export const VARIATION_KEY_DESCRIPTION =
  "Stable key sent with exposure events (e.g. `0`, `1`). Don't change after launch.";

export const VARIATION_NAME_DESCRIPTION =
  "Short label shown in results (e.g. `Control`).";

export const VARIATION_DESCRIPTION = "What this variation changes.";

export const METRIC_NAME_DESCRIPTION =
  "Short display name (e.g. `Purchases per user`). Put the definition in `description`.";

export const SAVED_GROUP_NAME_DESCRIPTION =
  "Short display name (e.g. `Internal employees`). Put details in `description`.";

export const SAVED_GROUP_DESCRIPTION =
  "Short note (max 100 characters) on who is in the group and why.";

export const GENERIC_NAME_DESCRIPTION =
  "Short display name. Put details in `description`.";

export const PLAIN_DESCRIPTION = "Put context here, not in the name.";

export const REVISION_TITLE_DESCRIPTION =
  "Short draft title (e.g. `Enable for beta testers`).";

export const REVISION_COMMENT_DESCRIPTION =
  "Markdown. What changed and why, for reviewers.";

export const PROJECTS_DESCRIPTION =
  "Project IDs. Use projects instead of prefixing names.";

export const ENVIRONMENT_PROJECTS_DESCRIPTION =
  "Limits which projects can use this environment. Omit to allow all projects.";

export const REVIEW_COMMENT_DESCRIPTION =
  "Markdown. Why you approved or requested changes.";
