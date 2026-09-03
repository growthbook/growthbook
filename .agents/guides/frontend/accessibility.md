# Frontend Accessibility

Keyboard and screen-reader requirements for GrowthBook UI.

**Nothing here is linted.** `eslint-plugin-jsx-a11y` is not installed and no a11y rule is enabled anywhere in `eslint.config.mjs`. Every rule on this page is caught by a human or by nobody. The only precedent in code lives inside the design system itself — `ui/Callout.tsx` sets `role="alert"` for its `error` and `attention` statuses and labels its dismiss button `aria-label="Dismiss"`; `ui/Button.tsx` passes `aria-label`, `aria-disabled`, and `aria-pressed` straight through.

The design-system primitives are the shortest path to a correct control. Reach for them first and most of this page takes care of itself.

## A `div` with `onClick` is not a button

A `<div>`, `<Box>`, `<Flex>`, `<span>`, `TableRow`, or SVG `<rect>` carrying `onClick` and `cursor: pointer` gets no tab stop, no Enter/Space activation, and no announced role. Keyboard users cannot reach it and screen readers do not describe it.

### ❌ DON'T

```tsx
<Flex onClick={() => selectMetric(id)} style={{ cursor: "pointer" }}>
  {metric.name}
</Flex>
```

### ✅ DO — in order of preference

```tsx
// 1. A design-system control. Link renders a real <button> when given
//    onClick and no href.
import Link from "@/ui/Link";
<Link onClick={() => selectMetric(id)}>{metric.name}</Link>;

// 2. A menu item, when the control lives in a menu.
import { DropdownMenuItem } from "@/ui/DropdownMenu";
<DropdownMenuItem onClick={select}>{metric.name}</DropdownMenuItem>;

// 3. A real <button>, when you need bare markup.
<button type="button" onClick={select}>
  {metric.name}
</button>;
```

Only if none of those fit, add `role="button"`, `tabIndex={0}`, and an Enter/Space key handler yourself. Follow the `activateOnKey` helper in `packages/front-end/components/Search/SidebarExperimentFilters.tsx` — it is module-local there, so lift it into a shared hook rather than writing a third copy.

## A clickable row must not be the only way in

When a whole row's `onClick` is the only path to a modal or a detail view, the action is both unreachable by keyboard and invisible to a sighted user scanning for something to press. Put an explicit `@/ui/Button` or `@/ui/LinkButton` in the row ("View splits", "Edit"). Keeping the row click as a convenience on top of that is fine.

## Icon-only controls need an accessible name

A `@/ui/Button` or Radix `IconButton` whose children are just `<PiX />`, a kebab trigger, an expand caret, or a status dot announces as "button" and nothing else (WCAG 4.1.2).

### ❌ DON'T

```tsx
<Button variant="ghost" color="red">
  <PiX />
</Button>
```

### ✅ DO

```tsx
<Tooltip content="Remove computed column">
  <Button
    variant="ghost"
    color="red"
    size="sm"
    aria-label="Remove computed column"
    onClick={remove}
  >
    <PiX />
  </Button>
</Tooltip>
```

- `aria-label` names the **action**, not the glyph. "Remove computed column", not "X icon".
- Wrap it in `@/ui/Tooltip` so sighted users get the same name on hover and focus.
- A purely decorative indicator that conveys meaning takes `role="img"` plus `aria-label`; one that conveys nothing takes `aria-hidden`.
- Never put an actionable control inside hover-only tooltip chrome — see [Mouse-only affordances](#mouse-only-affordances) below.

## Disclosure and selection state must be exposed

| Situation                                               | Required attribute         |
| ------------------------------------------------------- | -------------------------- |
| A control that expands/collapses content                | `aria-expanded={expanded}` |
| A hand-rolled toggle whose on-state is only visual      | `aria-pressed={active}`    |
| A hand-rolled tab or nav item whose selection is visual | `aria-current="page"`      |

```tsx
<Link aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
  {expanded ? "Hide completed items" : "View completed items"}
</Link>
```

Two more things that come with a disclosure:

- **Flip the label with the state.** "View completed items" → "Hide completed items". A static label plus a rotating caret leaves screen-reader users guessing.
- **Make the label and the caret one element.** Two adjacent click targets means two tab stops for one action, and a hit target the size of the glyph.

Radix-backed primitives (`@/ui/Tabs`, `@/ui/DropdownMenu`, `@/ui/Popover`, `@/ui/Select`) already wire all of this. You only owe these attributes on a control you built yourself.

## Every form control needs an accessible name

A bare `<label>`, a `<Text as="label">`, or a bold `<Text>` sitting above a control is not a label: without `htmlFor`/`id` it does not focus the control on click and screen readers never announce the pairing.

Pass the text to the control's own `label` prop — `@/ui/Checkbox`, `@/ui/Switch`, `@/ui/Select`, `@/ui/MultiSelectField`, `@/components/Forms/Field`, and the legacy `@/components/Forms/SelectField` and `@/components/Experiment/MetricSelector` where those are already in use — or wire `htmlFor`/`id` yourself.

`@/ui/Select` is `label`-only. Its prop type is closed and anything extra spreads onto the wrapper `<Flex>`, not the trigger, so `aria-label` never reaches the control. A string `label` is the only working route.

### `@/ui/TextField` — read this before assuming `label` is enough

`TextField`'s `label` is **optional**, and it only wires `htmlFor` when the label is a **string**:

- `label="Metric name"` → renders `<Text as="label" htmlFor={inputId}>`. Correctly associated.
- `label={<Flex>…</Flex>}` → the node is rendered as-is, with **no `htmlFor`**. Not associated.
- `label` omitted → no label element at all. There is no `aria-label` fallback and no dev warning.

So the accessible name is only guaranteed when you pass a **string** `label`. If the label has to be a JSX node, supply the name another way: `aria-label` on the field, or `aria-labelledby` pointing at the node's `id`, or an explicit `id` on the field plus `htmlFor` on your own label.

```tsx
// ✅ string label — wired
<TextField label="Metric name" value={name} onChange={onChange} />

// ✅ node label — name supplied explicitly
<TextField
  id="metric-name"
  label={
    <Flex align="center" gap="1">
      Metric name <PiInfoFill />
    </Flex>
  }
  aria-label="Metric name"
  value={name}
  onChange={onChange}
/>
```

## A raw `<a>` is not a link

Two separate problems, both real:

- `<a href="#" onClick>`, `<a onClick>` with no `href`, or `<a role="button">` is **not keyboard-activatable** (WCAG 2.1.1). An anchor without an `href` is not focusable and Enter does nothing.
- A raw internal `<a href="/features/abc">` triggers a **full page reload**, dropping SPA state and every cached SWR response.

Use `@/ui/Link` (which renders a real `<button type="button">` when given `onClick` and no `href`, and a Next.js `<Link>` when given `href`), or `@/ui/LinkButton` — with the `external` prop for an outbound URL. See `react-patterns.md` for the component-choice half of this rule.

## Mouse-only affordances

An action that only exists under the pointer does not exist for a keyboard.

- **Hover-reveal.** A row action that appears on `:hover` only must also appear on `:focus-within`, and its trigger must be focusable.
- **Tooltip-only triggers.** A non-focusable `<span>` wrapped in a tooltip never fires the tooltip for a keyboard user. Make the trigger a `@/ui/Button variant="ghost" size="sm"` or give it `tabIndex={0}`.
- **A tooltip is never the only carrier of required information.** If the user must know it to proceed, put it in `description`, `helpText`, or a `@/ui/Callout`.
- **A natively `disabled` button suppresses pointer events**, so a tooltip wrapping it never fires — the explanation you attached is invisible. See the disabled-control patterns in [ui-states.md](ui-states.md).
- **Enter must submit a form.** A field plus a `@/ui/Button` with `onClick` and no `<form>` wrapper gives no implicit submission, so Enter in the field does nothing. Wrap the fields in `<form onSubmit={…}>` and give the button `type="submit"` — `@/ui/Button` defaults to `type="button"`, and its `onClick` handler calls `preventDefault()`, so drive the submit from `onSubmit` rather than both. A single-field form is not an exemption.

## Do not nest interactive content inside a `<label>`

A `<label>` wrapping a select, an input, or a button steals clicks and produces an ambiguous accessible name. `@/ui/RadioGroup` handles this for you, but you have to ask for it: `renderOutsideItem` is a **per-option field on `RadioOptions`**, not a top-level prop.

```tsx
<RadioGroup
  value={mode}
  setValue={setMode}
  options={[
    { value: "auto", label: "Automatic" },
    {
      value: "manual",
      label: "Manual",
      // The disclosed content contains a Select, so render it as a sibling
      // of the radio item rather than inside its <label>.
      renderOutsideItem: true,
      renderOnSelect: (
        <Select label="Source" value={source} setValue={setSource}>
          <SelectItem value="sql">SQL</SelectItem>
        </Select>
      ),
    },
  ]}
/>
```

Set it on any option whose `renderOnSelect` content is interactive. Leave it off for plain descriptive text.

## Focus must survive a panel switch

When you swap panels or steps inside one widget, unmounting the focused control drops focus to `document.body` — the keyboard user loses their place and a screen reader goes silent. Move focus to a sensible target in the new panel (its heading, or its first control) with a `ref` and `.focus()`.
