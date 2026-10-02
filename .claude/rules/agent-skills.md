---
paths:
  - "packages/back-end/src/api/**/*.ts"
  - "packages/shared/src/validators/**/*.ts"
  - "packages/back-end/generated/spec.yaml"
  - "packages/back-end/src/models/**/*.ts"
  - "packages/back-end/src/enterprise/models/**/*.ts"
  - "packages/shared/src/enterprise/**/*.ts"
  - "packages/shared/src/util/features.ts"
  - "packages/back-end/src/services/featurePublishGates.ts"
  - "packages/back-end/src/revisions/**/*.ts"
  - "docs/api/introduction.mdx"
  - "docs/features/**"
  - "docs/experiments.mdx"
  - "docs/running-experiments/**"
  - "docs/statistics/**"
  - "docs/experimentation-analysis/**"
  - "docs/app/experiment-results.mdx"
  - "docs/app/experiment-configuration.mdx"
  - "docs/app/experiment-decisions.mdx"
  - "docs/app/metrics.mdx"
  - "docs/app/metrics/**"
  - "docs/app/sticky-bucketing.mdx"
  - "docs/bandits/**"
  - "docs/kb/experiments/troubleshooting-experiments.mdx"
  - "docs/faq.mdx"
---

# Agent Skills

The growthbook/skills skills depend on the REST API and docs in these files (the same list as `scripts/agent-skills-watch-paths.txt`). Before finishing a change here, read and follow `.agents/guides/agent-skills.md`, and tell the user which skills the change affects.
