# Frontend React & TypeScript Patterns

## Component Structure

- Use **functional components** with TypeScript
- Define props interfaces inline or as separate types
- Use explicit return types for complex functions

### Example Component Structure

```typescript
import { ReactNode } from "react";
import { useUser } from "@/services/UserContext";

export default function MyComponent({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { organization, hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("feature-name");

  // Component logic here

  return (
    <div>
      {hasFeature && <span>Premium content</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  );
}
```

## Commercial Features

- Check feature availability with `hasCommercialFeature("feature-name")`
- Wrap premium features with `<PremiumTooltip commercialFeature="feature-name">`
- Feature flags are defined in `packages/shared/src/enterprise/license-consts.ts`

## Common Hooks

- `useUser()` - Access user context, organization, permissions
- `useEnvironments()` - Get available environments
- `useDefinitions()` - Access metrics, features, segments
- `useAuth()` - Authentication state

Context providers are in `packages/front-end/services/`

## UI Copy & Casing

When writing user-facing strings (labels, headings, buttons, placeholders, body copy), follow the casing rules in [ui-copy-style.md](../ui-copy-style.md) — the repo-wide copy guide, which also covers back-end and API messages. In short: Title Case for `<Heading>` elements, sentence case for everything else, and always-Title-Case for named resources (GrowthBook, Visual Editor, North Star, Bandit, Data Source, Fact Metric, Feature Flag, Saved Group, SDK Connection) even mid-sentence. The fixed scope label "All Projects" is also Title Case, but bare "project" is a lowercase common noun.

## UI Component Hierarchy

When building UI, follow this priority order for component selection:

### 1. Design System Components (`@/ui/`) - PREFERRED

Always check the design system first. These components are purpose-built for GrowthBook and provide consistent styling and behavior:

#### Import shapes — copy the exact line

Export shapes are **not** uniform: most `@/ui/` components are **default** exports, a few are named-only, and `TextField` is both. Getting this wrong does not fail gracefully — `import { Button } from "@/ui/Button"` compiles to `undefined`. Copy the line from this table.

| Component                   | Import line                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Avatar`                    | `import Avatar from "@/ui/Avatar";`                                                                                          |
| `Badge`                     | `import Badge from "@/ui/Badge";`                                                                                            |
| `Breadcrumbs`               | `import Breadcrumbs from "@/ui/Breadcrumbs";`                                                                                |
| `Button`                    | `import Button from "@/ui/Button";` (also named: `WhiteButton`)                                                              |
| `Callout`                   | `import Callout from "@/ui/Callout";`                                                                                        |
| `Checkbox`                  | `import Checkbox from "@/ui/Checkbox";`                                                                                      |
| `ConfirmDialog`             | `import ConfirmDialog from "@/ui/ConfirmDialog";`                                                                            |
| `DataList`                  | `import DataList from "@/ui/DataList";`                                                                                      |
| `DropdownMenu`              | `import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";` — named only                                           |
| `ErrorDisplay`              | `import ErrorDisplay from "@/ui/ErrorDisplay";`                                                                              |
| `Frame`                     | `import Frame from "@/ui/Frame";`                                                                                            |
| `Heading`                   | `import Heading from "@/ui/Heading";`                                                                                        |
| `HelperText`                | `import HelperText from "@/ui/HelperText";` (also named: `getRadixColor`, `RadixStatusIcon`)                                 |
| `Link`                      | `import Link from "@/ui/Link";`                                                                                              |
| `LinkButton`                | `import LinkButton from "@/ui/LinkButton";`                                                                                  |
| `Metadata`                  | `import Metadata from "@/ui/Metadata";`                                                                                      |
| `Modal`                     | `import Modal from "@/ui/Modal";` — then `<Modal.Root>`, `<Modal.Header>`, `<Modal.Body>`, `<Modal.Footer>`, `<Modal.Close>` |
| `ModalStandard`             | `import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";`                                                             |
| `MultiSelectField`          | `import MultiSelectField from "@/ui/MultiSelectField";`                                                                      |
| `Pagination`                | `import Pagination from "@/ui/Pagination";`                                                                                  |
| `Popover`                   | `import { Popover, PopoverContent } from "@/ui/Popover";` — named only                                                       |
| `PremiumCallout`            | `import PremiumCallout from "@/ui/PremiumCallout";`                                                                          |
| `ProgressBar`               | `import { ProgressBar } from "@/ui/ProgressBar";` — named only                                                               |
| `RadioCards`                | `import RadioCards from "@/ui/RadioCards";`                                                                                  |
| `RadioGroup`                | `import RadioGroup from "@/ui/RadioGroup";`                                                                                  |
| `Select`                    | `import { Select, SelectItem } from "@/ui/Select";` — named only (also `SelectGroup`, `SelectLabel`, `SelectSeparator`)      |
| `SplitButton`               | `import SplitButton from "@/ui/SplitButton";`                                                                                |
| `StringArrayField`          | `import StringArrayField from "@/ui/StringArrayField";`                                                                      |
| `Switch`                    | `import Switch from "@/ui/Switch";`                                                                                          |
| `Table`                     | `import Table, { TableHeader, TableBody, TableRow, TableColumnHeader, TableCell } from "@/ui/Table";`                        |
| `Tabs`                      | `import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";` — named only (also `StickyTabsList`)                 |
| `Text`                      | `import Text from "@/ui/Text";`                                                                                              |
| `TextField`                 | `import TextField from "@/ui/TextField";` — default **and** named; `TextFieldSlot` is named only                             |
| `Tooltip`                   | `import Tooltip from "@/ui/Tooltip";`                                                                                        |
| `TruncateMiddleWithTooltip` | `import { TruncateMiddleWithTooltip } from "@/ui/TruncateMiddleWithTooltip";` — named only                                   |
| `VariationLabel`            | `import VariationLabel from "@/ui/VariationLabel";`                                                                          |
| `VariationNumber`           | `import VariationNumber from "@/ui/VariationNumber";`                                                                        |

`@/ui/` resolves to `packages/front-end/ui/` (tsconfig maps `"@/*"` to `"./*"`). When in doubt, open the file and read its `export default` / `export const` line — that is the only authority.

Most `@/ui/` components ship a `.stories.tsx` next to them (30 of 43). Read the story to learn the intended props and variants before judging whether a component is used correctly. There is **no Storybook** — the stories render through a hand-rolled page at `packages/front-end/pages/design-system/index.tsx`.

#### Size props

Every `@/ui/` size prop uses one t-shirt ladder, defined in `ui/sizes.ts`. Never Radix numbers (`size="2"`) and never words (`size="medium"`).

```typescript
import { radixSize, Size } from "@/ui/sizes";

// declare the subset this component supports
size?: Size<"sm" | "md">;

// map it once, at the Radix passthrough
<RadixCallout.Root size={radixSize(size)} />
```

`sm`/`md`/`lg`/`xl` are Radix `1`/`2`/`3`/`4`. `xs` and `2xl` are names with no shared meaning; a component that offers one maps it itself.

Three rules:

- Support a **subset**, never a renaming. Adding a step to a component is a one-word change. Changing what a step _means_ is an edit to `RADIX_SIZE` and moves every component at once.
- Don't add a step to `TshirtSize` to serve one component.
- When a Radix primitive lacks the step you mapped to, `radixSize`'s return type makes the passthrough fail to compile. That is the guard working. Narrow the subset or handle that one step locally with a comment saying why. Never cast.

`Heading` and `Modal` keep their own maps, both documented in the files. The design-system page has a Size cohesion section showing every step and every gap.

### 2. Radix Themes - SECONDARY

If a component doesn't exist in `@/ui/`, check Radix Themes. It is the expected default for layout — `@radix-ui/themes` is imported in 700+ front-end files.

`no-restricted-imports` blocks these names from `@radix-ui/themes` with "Don't import Radix directly. Use our design system wrappers from @/ui/ instead.": `Avatar`, `Badge`, `Button`, `Callout`, `Checkbox`, `DataList`, `Dialog`, `DropdownMenu`, `Heading`, `Link`, `RadioCards`, `RadioGroup`, `Select`, `Switch`, `Table`, `Tabs`, `Text`. Use the `@/ui/` wrapper for every one of those.

Everything **not** on that list is intentionally allowed straight from Radix. In particular:

```typescript
// ✅ Correct - these have no @/ui/ wrapper and are deliberately not blocked
import { Flex, Box, Grid, IconButton, Separator } from "@radix-ui/themes";
```

`IconButton` comes from `@radix-ui/themes`. **There is no `@/ui/IconButton`** — do not import one.

### 3. Existing GrowthBook Components - TERTIARY

Check `packages/front-end/components/` for domain-specific components that may already exist.

### 4. Build New Components - LAST RESORT

If none of the above work, build a new component.

**Before building inline or one-off components, ask yourself:** Could this be useful elsewhere in the codebase? If the component is generic and reusable (not domain-specific), propose adding it to `@/ui/` instead of building it inline.

**When to suggest a new `@/ui/` component:**

- The pattern is generic (not tied to a specific feature/domain)
- Similar UI patterns exist elsewhere in the codebase
- The component wraps a Radix primitive with GrowthBook-specific styling
- You're about to duplicate similar markup/logic in multiple places

**Ask the user before creating:** "This looks like a reusable pattern. Should I create a new `@/ui/ComponentName` component that can be used across the codebase?"

New `@/ui/` components should:

- Live in `packages/front-end/ui/`
- Include a `.stories.tsx` file — the repo has no Storybook; stories render through `packages/front-end/pages/design-system/index.tsx`
- Follow existing component patterns in that folder

## Avoid Bootstrap

**Bootstrap classes are legacy and should NOT be used in new code.** The codebase is migrating away from Bootstrap toward our design system.

### ❌ DON'T - Bootstrap Classes

```tsx
// ❌ Bad - Bootstrap utility classes
<div className="d-flex justify-content-between align-items-center">
<div className="mb-3 mt-2">
<div className="btn btn-primary">
<span className="badge bg-success">
<div className="container-fluid">
<div className="row">
<div className="col-md-6">
```

### ✅ DO - Design System & Radix Themes

```tsx
// ✅ Good - Radix Themes layout primitives
<Flex justify="between" align="center">
<Box mb="3" mt="2">

// ✅ Good - Design system components
<Button variant="solid">Click me</Button>
<Badge color="green">Active</Badge>

// ✅ Good - CSS Modules or inline styles when needed
<div className={styles.container}>
<div style={{ display: "flex", gap: "8px" }}>
```

### Common Bootstrap → Design System Migrations

| Bootstrap Class              | Replacement                               |
| ---------------------------- | ----------------------------------------- |
| `btn btn-primary`            | `<Button>` from `@/ui/Button`             |
| `btn btn-outline-*`          | `<Button variant="outline">`              |
| `badge bg-*`                 | `<Badge>` from `@/ui/Badge`               |
| `form-check` / `form-switch` | `<Checkbox>` or `<Switch>` from `@/ui/`   |
| `nav nav-tabs`               | `<Tabs>` from `@/ui/Tabs`                 |
| `table`                      | `<Table>` from `@/ui/Table`               |
| `alert alert-*`              | `<Callout>` from `@/ui/Callout`           |
| `dropdown`                   | `<DropdownMenu>` from `@/ui/DropdownMenu` |
| `d-flex`                     | `<Flex>` from `@radix-ui/themes`          |
| `d-none` / `d-block`         | Conditional rendering or CSS              |
| `mb-*` / `mt-*` / `mx-*`     | `<Box mb="3">` or style props             |
| `row` / `col-*`              | `<Grid>` from `@radix-ui/themes`          |
| `text-center` / `text-end`   | `<Text align="center">` or CSS            |

### When You Encounter Bootstrap

If you're modifying code that uses Bootstrap:

1. **Small changes**: OK to leave existing Bootstrap, but don't add more
2. **New features**: Use design system components exclusively
3. **Refactoring**: Migrate Bootstrap to design system when touching that code

## Legacy Component Swaps

The Bootstrap table above covers CSS classes. These are the legacy **components** to migrate away from. As with Bootstrap: do not introduce new usage, and swap what you are already editing.

| Legacy                                     | Replacement                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `@/components/Modal`                       | `ModalStandard` from `@/ui/Modal/Patterns/ModalStandard` — **lint-blocked**  |
| `@/components/Button`                      | `@/ui/Button`                                                                |
| `@/components/Forms/SelectField`           | `{ Select, SelectItem }` from `@/ui/Select`                                  |
| `MoreMenu` (especially `useRadix={false}`) | `{ DropdownMenu, DropdownMenuItem }` from `@/ui/DropdownMenu`                |
| `className="box"` / `className="appbox"`   | `@/ui/Frame`                                                                 |
| Raw `<a>` / `<a href="#" onClick>`         | `@/ui/Link` or `@/ui/LinkButton`                                             |
| `size="legacy"` on any form control        | A t-shirt size, or omit `size` — **lint-blocked** via `no-restricted-syntax` |

`@/ui/MultiSelectField` is still the right choice where `@/ui/Select` has no multi-value variant. When migrating a `SelectField`, pass `legacyLabelFormatting={false}` rather than keeping `size="legacy"`.

## Cards and Panels — `@/ui/Frame`

`@/ui/Frame` **renders `className="appbox"` itself**, wrapped around a Radix `Box` with `mb="4" py="5" px="6"` and dark-mode handling. So `appbox` is not a banned class — it is Frame's implementation detail. What is wrong is writing it by hand.

### ❌ DON'T

```tsx
<Box className="appbox">…</Box>
<div style={{ border: "1px solid var(--gray-a5)", borderRadius: 6, background: "var(--color-panel)" }}>…</div>
```

### ✅ DO

```tsx
import Frame from "@/ui/Frame";

<Frame>…</Frame>;
```

Before hand-rolling a card shell, check whether the sibling section already has one you can reuse. Do not nest a `Frame` inside a `Frame` — one surface, one border.

One caveat: do not wrap a container that holds a `MultiSelectField` or another popover in Radix `Card` chrome — its overflow clips the dropdown. Use `Frame` or a plain `Box` with the chrome you need.

## Links and Click Actions — `@/ui/Link`

A raw anchor is wrong twice over: `<a href="#" onClick>`, `<a onClick>` with no `href`, and `<a role="button">` are not keyboard-activatable (WCAG 2.1.1), and a raw internal `<a href="/features/abc">` triggers a full page reload that loses SPA state and every cached SWR response.

```tsx
import Link from "@/ui/Link";
import LinkButton from "@/ui/LinkButton";

// Navigation — renders a Next.js <Link>
<Link href={`/metric/${id}`}>{metric.name}</Link>

// A click action — renders a real <button type="button">
<Link onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
  Show details
</Link>

// A button-shaped link, or an outbound URL
<LinkButton href="https://docs.growthbook.io/…" external>
  View docs
</LinkButton>
```

**Link or Button?** `@/ui/Link` for secondary and navigational actions. `@/ui/Button` for anything primary, async, or submission-unblocking — Button gives you loading and disabled affordances and `setError` for free, so a `Link` with hand-rolled `pointerEvents` disabled styling is always the wrong shape.

Keep the sole recovery or confirm CTA a default solid `Button` (no `variant="outline"`) so it matches sibling primary actions.

## Raw HTML Controls

Every one of these has a design-system equivalent that already handles the label association, sizing, and error slot.

| Raw                       | Replacement                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `<input type="checkbox">` | `@/ui/Checkbox` — `label` and `description` props map 1:1     |
| `<input type="text">`     | `@/ui/TextField` or `@/components/Forms/Field`                |
| `<textarea>`              | `@/components/Forms/Field` with its `textarea` prop           |
| `<select>`                | `{ Select, SelectItem }` from `@/ui/Select`                   |
| `<button>`                | `@/ui/Button`, or Radix `IconButton` for an icon-only control |

Raw controls are still common — `<button` appears in 112 front-end files and `<input` in 43 — so the rule is again "do not introduce new usage".

`@/ui/Checkbox`'s `label` keeps the label a real click target for you. Hand-written label markup next to a raw input almost never does; see [accessibility.md](accessibility.md).

## Checkbox vs Switch

Two components for one boolean, and the choice is not stylistic:

> Use `@/ui/Switch` when selecting the input has an immediate effect in the UI, such as revealing additional fields. Otherwise prefer `@/ui/Checkbox`.

- **`@/ui/Switch`** — the toggle changes the UI or the system now: it reveals or hides fields, or it persists optimistically.
- **`@/ui/Checkbox`** — the toggle is a form value applied when the user submits.

```tsx
// ❌ A Checkbox that immediately reveals nested fields
<>
  <Checkbox
    label="Require approval to publish changes"
    value={requireApproval}
    setValue={setRequireApproval}
  />
  {requireApproval && <ApprovalScopeFields />}
</>;

// ✅ Switch, because selecting it changes the form in place
<>
  <Switch
    label="Require approval to publish changes"
    value={requireApproval}
    onChange={setRequireApproval}
  />
  {requireApproval && <ApprovalScopeFields />}
</>;
```

Note the different APIs. `Checkbox` takes `value` / `setValue`; `Switch` takes either `value` + `onChange` (controlled) or `defaultValue` (uncontrolled) — a discriminated union, so you cannot mix them. `Switch` also takes `label`, `description` (a plain string), `state?: "default" | "warning" | "error"`, `stateLabel`, and `size?: "sm" | "md" | "lg"`.

## Variation Identity — `VariationLabel` / `VariationNumber`

Variation identity is never hand-rolled. Rendering it as prose, an interpolated `"Variation N"` string, or your own color palette breaks the design system's number badge and its `$variant-0..8` color-as-identity mapping.

```tsx
import VariationLabel from "@/ui/VariationLabel";
import VariationNumber from "@/ui/VariationNumber";

// Number + name
<VariationLabel number={i} name={variation.name} />

// Just the badge (0 is always the control)
<VariationNumber number={i} />
```

`VariationLabel` takes `{ number, name, size?, maxWidth?, disableTooltip? }`. `VariationNumber` takes `{ number }` plus Radix `Box` props.

Do not pass a fallback like ``name={variation.name || `Variation ${i}`}`` — it duplicates the number the badge already shows. Pass the real name, or use `VariationNumber` alone.

## Inline Layout Styles

If a Radix primitive exposes the prop, use the prop. An ad-hoc `style={{}}` object bypasses the spacing scale, the theme tokens, and dark mode.

### ❌ DON'T

```tsx
<div
  style={{
    position: "sticky",
    bottom: 0,
    width: "100%",
    backgroundColor: "var(--color-panel)",
  }}
>
```

### ✅ DO

```tsx
<Box position="sticky" bottom="0" width="100%">
```

| Inline style                                 | First-class prop                            |
| -------------------------------------------- | ------------------------------------------- |
| `display: "flex"`, `flexDirection: "column"` | `<Flex direction="column">`                 |
| `flexGrow: 1`                                | `flexGrow="1"`                              |
| `position`, `bottom`, `top`, `width`         | `position="sticky" bottom="0" width="100%"` |
| `gridTemplateColumns: "1fr auto 1fr"`        | `<Grid columns="1fr auto 1fr">`             |
| `maxWidth: 420`                              | `maxWidth="420px"`                          |
| `padding`, `margin`                          | `px="4"`, `py="5"`, `mb="4"`                |
| `gap: 8`                                     | `gap="2"` on `Flex` / `Grid`                |

A CSS Module (`*.module.scss`) is the right home for anything a prop cannot express — a `:hover` rule, a keyframe, a complex selector. Never inject a raw `<style>{…}</style>` block at render time: it leaks global selectors and re-emits once per instance.

## Tokens and Spacing

- **No raw color-scale variables inline.** `var(--red-11)`, `var(--violet-9)`, a hex, an rgba, a shadow — reach for the component's semantic prop instead: `<DropdownMenuItem color="red">`, `<Text color="text-low">`, `<Badge color="gray">`.
- `@/ui/Text`'s `color` accepts only `"text-high" | "text-mid" | "text-low" | "text-disabled"`, and `@/ui/Heading`'s only `"text-high" | "text-mid" | "text-low"`. Do not nest an inline `<span style={{ color }}>` inside one to get a color outside that set — if you need a status color, you want `HelperText`, `Callout`, or `Badge`.
- `@/ui/Text` takes **no `className`**. If you are reaching for one, you want a different prop or a different component.
- **Stay on the spacing scale.** `paddingLeft: 20` is off-scale (16 is `4`, 24 is `5`); use `px="4"` / `px="5"`, `mb="4"`, `var(--space-4)`, or a `Flex` / `Grid` `gap`. If a shared component's internal padding is wrong for your case, add a `flush`/`inset` prop to it rather than cancelling it with `marginLeft: -4`.
- **No magic positional or viewport offsets.** `top: isUnresolved ? 63 : 12` and `calc(93vh - 200px)` break the moment anything above them changes. Derive from a named constant, a measured element, or `flexGrow` / `minHeight`.
- **One source per shared constant.** A breakpoint (`XS_BREAKPOINT = 520`) or a color map belongs in one module that every call site imports.

## Typography

- Section titles use `@/ui/Heading`, which **requires** `as`: `<Heading as="h4" size="sm" weight="semibold">`. Not a raw `<h2>` with Bootstrap utilities, and not a `<Text>` with a bold class.
- `@/ui/Text` renders an inline `<span>` by default, so `mt`/`mb` are silently dropped and heading semantics are lost. Pass `as="div"` / `as="p"` when you need block behavior.
- Everything else is `@/ui/Text` with `as` / `size` / `weight` / `color` tokens — not a raw `<span>`/`<small>`/`<em>` with inline `fontSize`, `fontWeight`, or `letterSpacing`, and not Bootstrap `text-muted`. An eyebrow label is `<Text size="sm" textTransform="uppercase" color="text-low">`.
- Casing for every string is owned by [ui-copy-style.md](../ui-copy-style.md). Do not decide it here.

## Don't Hand-Roll What Already Exists

| Instead of                                       | Use                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| A `<span>` with inline padding as a chip or pill | `@/ui/Badge` — e.g. `size="xs" radius="full" color="gray" variant="soft"` |
| A hand-drawn percentage or coverage bar          | `{ ProgressBar }` from `@/ui/ProgressBar`                                 |
| A circular or soft icon tile                     | `@/ui/Avatar` with `variant="soft"`                                       |
| A `<div>` styled as a divider                    | `<Separator size="4" my="2" />` from `@radix-ui/themes`                   |
| A native `title=` attribute                      | `@/ui/Tooltip` — its content prop is `content`                            |
| Truncated text with no way to read the rest      | `{ TruncateMiddleWithTooltip }` from `@/ui/TruncateMiddleWithTooltip`     |

Import the shared primitive under its real name — a local alias that renames it hides the reuse from the next reader.

## Configure Controls Through Their Own Props

Adding a sibling element or a wrapper to achieve what a prop already does fights the component.

- `helpText` on `@/components/Forms/Field` and `MultiSelectField` — including for hidden constraints ("each type must map to a same-named SQL column").
- `description` on `@/ui/Switch` is a **plain string**. Wrapping it in `<Text color="text-high">` fights the color the control already applies.
- `textarea` on `@/components/Forms/Field` instead of a raw `<textarea>`.
- `weight="regular"` on a nested `@/ui/Checkbox` so weight, not just indentation, carries the hierarchy.
- Omit an optional prop, or pass `undefined`, to mean "absent". An empty fragment (`<></>`) defeats the component's own empty handling.

## Layout and Information Architecture

Keep these four in mind; they are the ones that recur.

- **Primary action placement.** A page's primary action sits with the page title, not buried at the bottom of the first section. A section's action sits with that section's heading.
- **One solid primary per surface.** Two competing solid `Button`s read as two primary actions. Give the secondary one `variant="outline"`.
- **An Edit affordance opens what it sits next to.** An "Edit" control beside a section must open that section, not a different modal or a different page.
- **Truncated text needs a tooltip.** If you truncate, the full value must be reachable — `TruncateMiddleWithTooltip`, or `@/ui/Tooltip` around the truncated node.

## Reuse Before You Add

When the same markup, constants, or logic shows up in two or more places — row action menus, date-range pickers, card shells, tag rendering, status dots, reference counts — extract one shared component or hook and have both consume it.

- Before hand-rolling, check whether the file you are in **already imports** an equivalent shared component.
- When your PR introduces a new primitive, migrate **every** call site, including tooltip bodies and secondary render paths. A half-migration leaves two patterns where there was one.
- A component reused across unrelated features belongs in `packages/front-end/ui/`, not in one feature's folder — but read the [Build New Components - LAST RESORT](#4-build-new-components---last-resort) rules above first, including asking the user before creating one.

## Related Guides

- Icon sets and the legacy mapping table: [icons.md](icons.md)
- Keyboard and screen-reader requirements: [accessibility.md](accessibility.md)
- Error, loading, disabled, and empty states: [ui-states.md](ui-states.md)
- Fetch and mutation mechanics: [data-fetching.md](data-fetching.md)
- Copy and casing: [ui-copy-style.md](../ui-copy-style.md)
