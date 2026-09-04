# Frontend Icons

Which icon set to import from, and what to do when you meet a legacy one.

**This is convention, not tooling.** No lint rule and no `@deprecated` annotation enforces anything on this page. `react-icons/fa` is still imported in 188 front-end files against 337 for `react-icons/pi`, so you will keep meeting the legacy sets — the rule is only ever "do not introduce new usage".

## The two sanctioned sources

| Source                            | Use for                                                         | Import                                         |
| --------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Phosphor — `react-icons/pi`       | Everything generic: carets, arrows, plus, close, status, eye    | `import { PiPlus } from "react-icons/pi";`     |
| GrowthBook — `@/components/Icons` | GrowthBook-specific marks: nav entries, CUPED, sequential, etc. | `import { GBEdit } from "@/components/Icons";` |

`@/components/Icons` has no default export — every icon is a named export. 26 of its 29 exports are `GB*` (`GBHome`, `GBInfo`, `GBLibrary`, `GBIdea`, `GBExperiment`, `GBBandit`, `GBDatabase`, `GBPresentations`, `GBSettings`, `GBProductAnalytics`, `GBDimensions`, `GBSegments`, `GBMetrics`, `GBReports`, `GBArrowLeft`, `GBArrowRight`, `GBCircleArrowLeft`, `GBEdit`, `GBAddCircle`, `GBPremiumBadge`, `GBCuped`, `GBSequential`, `GBHashLock`, `GBRemoteEvalIcon`, `GBSuspicious`, `GBHeadingArrowLeft`). The other three are `ChartLineExploreIcon`, `VisualizationAddIcon`, and `AreaChartIcon`, so do not assume the prefix when reaching for a chart icon.

## Legacy sets — no new imports

`react-icons/fa`, `react-icons/fa6`, `react-icons/bs`, `react-icons/bi`, `react-icons/fi`, and `react-icons/md` are legacy. Do not add a new import from any of them, and do not extend an existing legacy import with another name. When you are already editing the JSX around one, swap it.

### ❌ DON'T

```tsx
import { FaAngleRight } from "react-icons/fa";

<FaAngleRight className="chevron" />;
```

### ✅ DO

```tsx
import { PiCaretRight } from "react-icons/pi";

<PiCaretRight />;
```

### Mapping table

| Legacy                         | Replacement                    |
| ------------------------------ | ------------------------------ |
| `FaAngleDown`                  | `PiCaretDown`                  |
| `FaAngleRight`                 | `PiCaretRight`                 |
| `FaExclamationTriangle`        | `PiWarningFill`                |
| `FaMagic`                      | `PiMagicWand`                  |
| `FaPlus`                       | `PiPlus`                       |
| `FaCircleCheck`                | `PiCheckCircleFill`            |
| `FaCircleXmark`                | `PiXCircleFill`                |
| `BiShow`                       | `PiEye`                        |
| `BsThreeDotsVertical`          | `PiDotsThreeVertical`          |
| A literal `←` / `→` text glyph | `PiArrowLeft` / `PiArrowRight` |

A literal arrow character is not an icon — it does not pick up icon sizing or color and it is read aloud by screen readers. Replace it.

### The one exception: brand logos

Phosphor has no third-party brand marks, so a brand logo stays on its legacy set. `FaSlack` for Slack, and the same for any other vendor mark. Nothing else qualifies.

## Carets: pick one pair and keep it

A disclosure control must use one consistent caret pair across the surface it lives on. Use `PiCaretDown` / `PiCaretUp` for a section that expands downward, or `PiCaretRight` / `PiCaretDown` for a tree row that expands in place. Do not mix a `PiCaretRight` collapsed state with a `PiCaretUp` expanded state in the same list.

A caret is a disclosure control, so it also needs `aria-expanded` and an accessible name — see [accessibility.md](accessibility.md).

## Pass icons through the component's own prop

Design-system components that take an icon expose a prop for it. Use the prop rather than nesting the icon in `children` next to the label.

### ❌ DON'T

```tsx
<Button>
  <Flex gap="1" align="center">
    <PiPlus /> Add metric
  </Flex>
</Button>
```

### ✅ DO

```tsx
<Button icon={<PiPlus />}>Add metric</Button>
```

`@/ui/Button` takes `icon` and `iconPosition` (`"left"` or `"right"`, `"left"` by default). It renders `children` inside a Radix `<Text weight="medium">`, so an icon nested in `children` ends up wrapped in that text element instead of sitting beside the label. `@/ui/Callout` takes `icon`, and `icon={null}` suppresses the status icon it would otherwise render — do not stack a second icon into its children to change it.

## Icon-only controls

An icon with no visible text is still a control and still needs a name. `aria-label`, focusability, and a `@/ui/Tooltip` wrapper are covered in [accessibility.md](accessibility.md).
