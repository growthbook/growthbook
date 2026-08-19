# Front-end Agent Instructions

Apply the repository instructions in the root `AGENTS.md` first.

Before changing front-end code, read the relevant detailed guide:

- React, UI components, and Bootstrap migration: `../../.agents/guides/frontend/react-patterns.md`
- Data fetching, mutations, cache refresh, and error handling: `../../.agents/guides/frontend/data-fetching.md`
- Permissions and commercial-feature gates: `../../.agents/guides/permissions.md`
- Copy and casing for labels, headings, buttons, and body copy: `../../.agents/guides/ui-copy-style.md`

Use the design-system components in `@/ui/` before Radix Themes or custom UI. Do not introduce new Bootstrap usage.

Permission controls must:

- Share server authority rules where possible; otherwise put predictions in a pure helper such as `shared/permissions/controlAuthority`.
- Cover both the permission atom in `back-end/test/api/permission-prediction-parity.test.ts` and its environment footprint in `front-end/test/footprintParity.test.ts`.
- Use independent, discriminating fixtures rather than deriving expected values through the implementation under test.

See `.agents/guides/flag-family-authority.md` for the authority rules.
