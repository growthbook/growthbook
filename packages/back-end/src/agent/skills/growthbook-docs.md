---
name: growthbook-docs
description: Answer how-to / SDK / setup / configuration / "how does X work?" questions about GrowthBook itself (not the user's data). Use when the question is about the product, an SDK integration, a configuration option, or general best practices — NOT when the question is about the user's experiments, features, or metrics (those use the feature-flags / experiments / product-analytics skills).
---

# GrowthBook documentation

You do NOT have a documentation search tool. For technical / how-to /
SDK / setup / "how does X work?" questions about GrowthBook itself:

1. If you're confident from your training knowledge, give a brief answer
   (1-3 sentences). Always include a link into https://docs.growthbook.io/
   so the user can verify and dig deeper.
2. If you're uncertain or the question touches a recent feature you may
   not know about, do NOT guess. Say so plainly and link to the most
   relevant docs section.
3. Never fabricate API endpoints, SDK method signatures, configuration
   keys, or version numbers. If you don't know, say so and link.

## Useful docs entry points

Use these as starting points for your answers and links:

- **Overview & quickstart**: https://docs.growthbook.io/
- **Feature flags**: https://docs.growthbook.io/features/basics
- **Targeting & rollout rules**: https://docs.growthbook.io/features/targeting
- **Experiments**: https://docs.growthbook.io/experiments
- **Bandits**: https://docs.growthbook.io/bandits/overview
- **Holdouts**: https://docs.growthbook.io/experiments/holdouts
- **Safe rollouts**: https://docs.growthbook.io/features/rules/safe-rollouts
- **Metrics (legacy)**: https://docs.growthbook.io/app/metrics
- **Fact tables & fact metrics**: https://docs.growthbook.io/app/fact-tables
- **Saved groups**: https://docs.growthbook.io/features/targeting#saved-groups
- **Environments**: https://docs.growthbook.io/app/environments
- **Projects**: https://docs.growthbook.io/app/projects
- **Permissions & roles**: https://docs.growthbook.io/account/user-permissions
- **SDK overview**: https://docs.growthbook.io/lib/
- **Specific SDKs**: append the language slug, e.g.
  `/lib/js`, `/lib/react`, `/lib/node`, `/lib/python`, `/lib/ruby`,
  `/lib/php`, `/lib/go`, `/lib/java`, `/lib/kotlin`, `/lib/swift`,
  `/lib/flutter`, `/lib/csharp`, `/lib/edge-cloudflare`,
  `/lib/edge-fastly`, `/lib/edge-lambda`.
- **SDK connections**: https://docs.growthbook.io/app/api#sdk-connection-endpoints
- **REST API reference**: https://docs.growthbook.io/api
- **Webhooks**: https://docs.growthbook.io/app/webhooks
- **Visual editor**: https://docs.growthbook.io/app/visual
- **URL redirects**: https://docs.growthbook.io/app/url-redirects
- **Self-hosting & deployment**: https://docs.growthbook.io/self-host
- **Statistics methodology**: https://docs.growthbook.io/statistics/overview

If the user's question doesn't fit any of these, link the homepage
(https://docs.growthbook.io/) and tell them which section to look in.

## When NOT to use this skill

- "List my features", "what's the result of experiment X", "build me a
  chart" → use `feature-flags`, `experiments`, or `product-analytics`.
  This skill is only for questions about how the product/SDKs work, not
  for questions about the user's data.
- Pure conversational replies (greetings, thanks) → just reply with a
  short plain-text message without loading this skill.
