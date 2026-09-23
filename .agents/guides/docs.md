# Docs (Mintlify MDX)

Read this before adding or editing pages under `docs/`.

## Quote YAML values that contain a colon

MDX frontmatter is YAML. A colon followed by a space (`: `) starts a nested mapping, so this is invalid:

```yaml
title: AI Mode: Generate A/B Test Variations With AI
```

Quote the value:

```yaml
title: "AI Mode: Generate A/B Test Variations With AI"
```

Same rule for `description`, `sidebarTitle`, and any other scalar. URLs like `https://example.com` are fine unquoted (no space after the colon).

CI enforces this with `node scripts/check-docs-frontmatter.mjs` in the Docs workflow.
