# Front-end Agent Instructions

Apply the repository instructions in the root `AGENTS.md` first.

Before changing front-end code, read the relevant detailed guide:

- React, UI components, and Bootstrap migration: `../../.agents/guides/frontend/react-patterns.md`
- Data fetching, mutations, cache refresh, and error handling: `../../.agents/guides/frontend/data-fetching.md`
- Permissions and commercial-feature gates: `../../.agents/guides/permissions.md`
- Copy and casing for labels, headings, buttons, and body copy: `../../.agents/guides/ui-copy-style.md`

Use the design-system components in `@/ui/` before Radix Themes or custom UI. Do not introduce new Bootstrap usage.

Any permission decision that mirrors a server authority rule belongs in a pure,
tested helper — `components/Revision/revisionAuthority.ts` for the flag family —
never inline in a page or component. Inline decisions drift from the endpoint they
are predicting: the recurring failure is a control that asks about the source
project of a move, the live entity instead of the selected revision, or an
environment footprint for an action that publishes nothing. If the UI and the
endpoint can disagree, they eventually will.
