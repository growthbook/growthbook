# Frontend UI States

Error, loading, disabled, and empty states — which component carries the message, and where it appears.

This page covers **where a state is shown and how it reads**. The fetch and mutation mechanics behind it — `useApi()`, `apiCall()`, `ErrorDisplay`, `LoadingOverlay`, `LoadingSpinner` — live in [data-fetching.md](data-fetching.md). Read that for the plumbing; read this for the surface.

## Pick the right carrier

| Scope                                           | Component                   | Import                                                     |
| ----------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| One field's validation or hint                  | `HelperText`                | `import HelperText from "@/ui/HelperText";`                |
| A section or page banner, optionally with a CTA | `Callout`                   | `import Callout from "@/ui/Callout";`                      |
| A failed request inside a dialog                | The dialog's own error slot | see [Dialogs](#dialogs-must-not-close-on-a-failed-request) |

Both are default exports.

### `HelperText` — field-level

`status` is **required** and takes exactly six values: `"wizard" | "info" | "warning" | "error" | "success" | "attention"`. There is no `variant` prop.

```tsx
<HelperText status="error" size="sm">
  Metric name is already in use
</HelperText>
```

Never hand-roll this. A `<div style={{ color: "var(--red-11)", fontSize: 12 }}>`, a raw `<span>` with an inline `--red-11`, a Bootstrap `text-danger`, or a neutral `<Text color="text-mid">` all lose the icon, the token, and the sizing.

Several form primitives already render `HelperText` for you from an `error` prop — `@/ui/TextField`, `@/ui/Select`, `@/ui/Checkbox`, and each `@/ui/RadioGroup` option all take `error` plus `errorLevel?: "error" | "warning"`. Prefer that over rendering a sibling `HelperText` yourself.

### `Callout` — section-level

`status` is **required** and uses the same six values. `Callout` has no `color` and no `variant` prop — the color comes from the status.

```tsx
<Callout
  status="error"
  action={
    <Button variant="ghost" color="inherit" onClick={retry}>
      Retry
    </Button>
  }
>
  We could not reach your Data Source.
</Callout>
```

- `action?: ReactNode` is a real slot. Put the CTA there, not inline in `children`.
- Give an action `Button` `variant="ghost" color="inherit"` so it takes the Callout's accent instead of fighting it.
- `icon={null}` suppresses the status icon. Passing a node replaces it. Do not stack a second icon into `children`.
- `status="error"` and `status="attention"` auto-set `role="alert"`; the others do not. Overriding `role` is possible but you almost never should.
- Drop the redundant chrome: no inner `<Text>` wrapper, no `<strong>Error: </strong>` prefix. The component supplies both.
- Bootstrap `alert alert-*` classes are **lint-enforced**: `local/no-alert-classname` is set to `"error"` for `packages/front-end/**/*.ts*` with the message "Do not use Bootstrap `alert` classes. Use the `Callout` component from `@/ui/Callout` instead."

### Match the status to the real severity

- `"attention"` (orange) for a security or privilege-escalation risk — it outranks `"warning"` (amber) and, like `"error"`, gets `role="alert"`.
- `"warning"` for a recoverable problem or a caveat.
- `"info"` (violet) reads as an **active** notice. Do not migrate a muted/archived banner to `"info"`; an archived state should read de-emphasized, so use `<Text color="text-low">` or a `@/ui/Badge`, not a blue banner.

Changing a banner's status changes its implicit ARIA role. Check that before you change it.

## Dialogs must not close on a failed request

A confirm or submit dialog that unmounts on a rejected request throws away the user's input and the error message with it. The user sees the dialog vanish and nothing else.

The design system already handles this, and it does **not** work through an error prop.

### `@/ui/ConfirmDialog`

Its props are exactly `title`, `content?`, `yesText?` (default `"Confirm"`), `noText?` (default `"Cancel"`), `onConfirm`, and `onCancel`. There is **no** `error` prop and **no** `open` prop — `open` is hardcoded `true`, so mounting and unmounting the dialog is the caller's job.

How the error actually surfaces: `ConfirmDialog` holds its own `error` state and passes `setError` into its confirm `<Button setError={setError}>`. `@/ui/Button` catches a rejection from an async `onClick`, hands the message to `setError`, and manages its own loading state. `ConfirmDialog` then renders `<HelperText status="error">{error}</HelperText>` above the footer. The dialog stays mounted throughout.

So: **let `onConfirm` reject.** Do not catch the error yourself and do not call `onCancel` in a `catch`.

```tsx
// ❌ swallows the error and closes the dialog
onConfirm={async () => {
  try {
    await apiCall(`/metric/${id}`, { method: "DELETE" });
    setOpen(false);
  } catch (e) {
    setOpen(false);
  }
}}

// ✅ Button catches the rejection and ConfirmDialog renders it inline
onConfirm={async () => {
  await apiCall(`/metric/${id}`, { method: "DELETE" });
  await mutate();
  setOpen(false);
}}
```

`@/ui/Button`'s `setError` is available anywhere, not just inside `ConfirmDialog`: give any async CTA a `setError` callback and render the captured message with `HelperText`, and you get the same behavior without writing a try/catch.

### Form modals

Use `ModalStandard` (`import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";`) for a form modal. It takes `open`, `header`, `submit`, `close`, `cta`, `ctaColor`, `ctaEnabled`, `size`, `dismissible`, `secondaryAction`, and `subheader`, and wires the footer submit button's loading state for you.

Do not import the legacy `@/components/Modal` — it is blocked by `no-restricted-imports` with the message "Use the new Modal from @/ui/Modal instead of the legacy Modal component." Never reach for it behind an `eslint-disable-next-line`.

Every `Modal.Root` branch, including the error and loading branches, needs a visible dismiss control. Escape and click-outside are not discoverable:

```tsx
<Modal.Footer>
  <Modal.Close>
    <Button variant="ghost">Close</Button>
  </Modal.Close>
</Modal.Footer>
```

## Surface a failure where the user triggered it

When an async action fails, the message belongs next to the control the user pressed — a section-level `<Callout status="error">` in that panel, or a `HelperText` under that field. Do not park it in state that only renders in an unrelated branch of the UI, where the user will never see it.

## Destructive actions need confirmation

An irreversible or silently mutating action — Delete, rewriting ids, clearing descriptions on a mode switch — must go through a confirmation with an explicit consequence line, not fire on click.

- Use `DeleteButton` (`import DeleteButton from "@/components/DeleteButton/DeleteButton";`) for a delete, or `@/ui/ConfirmDialog` for anything else.
- **Never use the browser-native `confirm()`.** It is unstyled, off-pattern, and if the action already flows through `DeleteButton` it double-confirms.

## Disabled controls must explain themselves

A control that is inert with no explanation is a dead end. Never ship one.

| Situation                                 | Do this                                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| A checkbox locked by permission or plan   | `@/ui/Checkbox`'s `disabledMessage?: string`                          |
| A radio option that cannot be chosen      | The option's `disabledReason?: ReactNode` on `RadioOptions`           |
| A button waiting on a request             | `@/ui/Button`'s `loading` prop — not `disabled={isLoading}`           |
| A locked Delete, or a section-wide block  | A `@/ui/Badge`, a `<Text color="text-low">` line, or a `@/ui/Callout` |
| Displaying a value the user cannot change | Read-only `@/ui/Text` or `@/ui/Badge` — never a `disabled` input      |

One trap: a natively `disabled` button **suppresses pointer events**, so a `@/ui/Tooltip` wrapping it never fires and the explanation you attached is invisible. Keep the trigger hover-reachable — either style the button as inert with `pointerEvents: "none"` instead of setting `disabled`, or wrap a muted non-disabled element.

## Loading and empty states share the loaded shell

A state change should not relocate the UI. Keep the surrounding shell — dialog frame, section heading, description — and swap only the part that has content.

### ❌ DON'T

```tsx
// Three different shells for one dialog action.
if (!data) return <LoadingOverlay />;
if (error) return <Modal.Root>…</Modal.Root>;
return <MetricForm />;
```

### ✅ DO

```tsx
// One shell; the body swaps.
<Modal.Root open>
  <Modal.Header>…</Modal.Header>
  <Modal.Body>
    {error ? (
      <Callout status="error">{error.message}</Callout>
    ) : !data ? (
      <LoadingSpinner />
    ) : (
      <MetricForm data={data} />
    )}
  </Modal.Body>
</Modal.Root>
```

The same applies to a section: keep the heading and description visible and render a short empty state for the list, rather than returning `null` for the whole section. A section that disappears reads as a bug, and the user loses the explanation of what would have been there.

An empty state should say what the thing is and give the action that fills it — a `@/ui/Button` or `@/ui/LinkButton` whose destination actually exists. See the CTA rules in `react-patterns.md`.

## Related

- Fetch and mutation mechanics, `ErrorDisplay`, `LoadingOverlay`: [data-fetching.md](data-fetching.md)
- Component choice and layout: [react-patterns.md](react-patterns.md)
- Casing and phrasing for every string on this page: [../ui-copy-style.md](../ui-copy-style.md)
