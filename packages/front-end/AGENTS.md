# Front-end Agent Instructions

Apply the repository instructions in the root `AGENTS.md` first.

Before changing front-end code, read the relevant detailed guide:

- React, UI components, and Bootstrap migration: `../../.agents/guides/frontend/react-patterns.md`
- Data fetching, mutations, cache refresh, and error handling: `../../.agents/guides/frontend/data-fetching.md`
- Permissions and commercial-feature gates: `../../.agents/guides/permissions.md`
- Copy and casing for labels, headings, buttons, and body copy: `../../.agents/guides/ui-copy-style.md`

Use the design-system components in `@/ui/` before Radix Themes or custom UI. Do not introduce new Bootstrap usage.

Any permission decision that MIRRORS a server authority rule belongs in a pure,
tested helper — `shared/permissions/controlAuthority` for the flag family, whose
predictions are held to the endpoints' own oracle by
`back-end/test/api/permission-prediction-parity.test.ts` — never inline in a page
or component.

"Mirrors" is the operative word. The rule exists to stop two implementations of one
decision drifting apart, so it applies when the control re-derives something the server
also derives. A rule the control and the endpoint both call — one function, no second
implementation — is a SHARED rule rather than a mirror, and belongs with its domain
(the ramp-schedule footprints in `shared/util/features.ts` are the worked example).
Prefer making a rule shared over mirroring it; mirror only what genuinely cannot be,
such as a prediction that needs data only the client has.

Inline decisions drift from the endpoint they are predicting: the recurring failure is a
control that asks about the source project of a move, the live entity instead of the
selected revision, or an environment footprint for an action that publishes nothing. If
the UI and the endpoint can disagree, they eventually will.

Two harnesses, and they cover different axes — a control needs both:

- `back-end/test/api/permission-prediction-parity.test.ts` holds predictions to the
  endpoints' oracle on the ATOM: which permission a role must hold.
- `front-end/test/footprintParity.test.ts` holds them on the FOOTPRINT: which
  environments the answer covers. It calls the real control functions rather than the
  shared helpers underneath them, because the helper was never where these bugs were —
  they were in what the control feeds it (which entity, which basis, which universe).

Two things that make a footprint case worthless, both of which shipped here before being
caught: computing the "endpoint" side by calling the same function the control calls
(unfalsifiable — assert a hardcoded value instead), and a fixture in which every
environment lands in every answer (then "return everything" coincides with correct —
keep one environment that no correct answer includes). Mutate the source and watch the
case fail before believing it. Note that front-end vitest resolves `shared/*` through
`dist`, so a mutation to `shared/src` alone silently survives: rebuild shared first or
the mutation check itself returns a false green.

The rules those helpers implement are stated in
`.agents/guides/flag-family-authority.md`.
