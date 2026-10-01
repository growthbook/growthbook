# Design Principles

Broad principles for designing GrowthBook screens, flows, and components. Use them when you explore a new design, critique an existing one, or choose between two options. They describe intent, not implementation. For the components and tokens that carry out these principles, see [frontend/react-patterns.md](frontend/react-patterns.md). For wording and casing, see [ui-copy-style.md](ui-copy-style.md).

GrowthBook's users are engineers, data scientists, and product managers. They make decisions that ship to production and change what their customers see. Design for people who are technical, busy, and accountable for the outcome.

## The root belief: GrowthBook is efficient

Every principle below serves one belief: GrowthBook should let users do their work with the least time, effort, and attention it takes to do it correctly. Efficient means fast to understand and fast to act on. It doesn't mean cramped, and it never means cutting corners on correctness or safety.

### Efficiency budgets

Use these budgets to check a design. They're starting points, not hard limits. If a design goes over one, the design notes or PR description should say why.

| Measure                    | Budget                                                                   | How to check                                                                                       |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Clicks to the common task  | 3 or fewer from the relevant list page                                   | Count each click, selection, and page change from the list page to a saved result.                 |
| Primary actions per view   | 1                                                                        | Count solid (primary) buttons visible at once. Modals and pages each count as one view.            |
| Time to the key answer     | Under 5 seconds for a first-time viewer                                  | Show the screen to someone unfamiliar with it and ask the one question it exists to answer.        |
| Key content above the fold | The primary task and its result fit in a 1440 × 900 viewport             | Load the screen at 1440 × 900 with realistic data and check without scrolling.                     |
| Rows visible in a list     | At least 10 at 1440 × 900                                                | Load a list with real data and count the rows on screen.                                           |
| Helper text                | 1 short sentence (about 15 words) per control, only where it's needed    | Read each line of helper text and delete it if it repeats the label.                               |
| Required fields            | Only fields with no sensible default                                     | For each required field, ask whether a default would be right most of the time.                    |
| Nesting depth              | 2 levels at most (a page in a modal, or a section in a card, not both)   | Count containers between the page and the content: cards, modals, panels, tabs.                    |
| Feedback after an action   | Visible within 100 ms; a progress indicator if the result takes over 1 s | Trigger the action and watch for a response. Long work shows progress rather than a frozen screen. |
| Re-entry on return         | 0 inputs to re-enter                                                     | Navigate away and back. Filters, scroll position, and unsaved input should all still be there.     |

When you compare two designs, prefer the one that meets more budgets, as long as it doesn't break a principle above it in the list.

## Visual philosophy

These describe the character of the product. Use them to judge whether a design feels like GrowthBook, not as rules for any one element.

- **The data is the hero.** The interface frames the content and doesn't compete with it. Tables, numbers, and results carry the visual weight; the controls around them stay smaller and lighter. When a screen feels busy, quiet the interface before you shrink the data.
- **Hierarchy through restraint.** Emphasis comes from a few levels of contrast and size, not from more colors, fonts, or styles. To make something stand out, make it darker or larger. Don't invent a new treatment.
- **Built for repeat use.** GrowthBook is designed for people who come back every day and want to move fast. Favor speed for experienced users over hand-holding, and put explanation where it's needed instead of everywhere.
- **Warm precision.** The product is exact without being cold. A technical, number-heavy tool can still feel calm and considered.

## Lessons from full-page flows

The metric creation flow was the first of the new full-page flows, and its review rounds kept returning to the same themes. Treat these as defaults for any new full-page flow.

### Fewer containers, tighter spacing

- Reviews repeatedly called out "too many boxes" and "too much padding." Put related settings in one container divided by rules, not a nested card per setting.
- Keep gaps between sections and padding inside them, especially horizontal padding, tight enough that more of the task fits on one screen.
- Don't let a side panel grow taller than the viewport and force the whole page to scroll.

### Cut text before adding it

- Remove intro paragraphs at the top of panels and sections. If the panel's purpose isn't clear without one, fix the panel.
- Move secondary explanation, such as caveats, how a value is calculated, or exact timestamps, into a tooltip.
- Write instructional copy ("Choose...", "Define...") only where the user can act on it. Hide it in read-only views.
- Don't show checks or statuses that can never fail. They add noise and teach users to ignore the area.

### Show the work behind a number

- Show the parts as well as the result, for example `600 / 80 = 7.5`. Users trust a number more when they can see how it was calculated.
- Don't headline a partial value, such as today's incomplete total. Show a complete, representative window instead.
- Show relative times ("3 hours ago") with the exact date and time in a tooltip, never a raw timestamp.

### Keep the definition visible

- Never hide anything that defines what the user is looking at, like filters or settings that change the result, behind a dropdown or a collapsed section. This matters most in read-only views.
- Order fields by dependency: a field comes right after the field it depends on.
- Name fields by what they mean to the user ("Retention period"), not by the implementation ("Window").
- Show secondary attributes, such as the Data Source that a table belongs to, with a quieter visual treatment, not in parentheses inside the main label.

### One scroll, stable layout, reachable actions

- Avoid scroll areas inside scroll areas. Let content grow to its natural height and rely on the page or panel scroll.
- Keep a panel the same size when the user switches tabs inside it, so the layout doesn't jump.
- Keep primary actions in view on long forms. A sticky action bar must clear the top navigation and never cover content.
- Put a frequently used action on a visible button, not only in an overflow menu.

### Choose the plainest control

- Use a checkbox for an on/off setting in a form, and indent the settings it reveals beneath it so they read as its children.
- Put descriptions and plan badges inside dropdown options, not in a separate line below the field.
- Focus the first field when a creation flow opens.

### Be honest about freshness and readiness

- Update cheap things, like generated SQL or cached results, automatically as the user edits. Keep expensive or external actions, like running a warehouse query, behind an explicit button.
- When a result is out of date, keep showing it with a clear "changes not applied" message rather than blanking it.
- When a change makes the old result meaningless, such as switching to a completely different metric type, return to the empty state.
- Disable an action while its inputs are incomplete, and show why. Every outcome, including "no rows returned," gets a message.

## 1. Trust comes first

Users act on what GrowthBook shows them: they ship a variation, kill a feature, or roll back a change. A wrong or ambiguous number costs more than a missing one.

- Show where a number comes from: the metric, the date range, the population, and the analysis settings.
- Distinguish clearly between a result and the absence of a result. Loading, empty, not-yet-significant, and error states each look different.
- State uncertainty. Show intervals and sample sizes next to the estimate, not behind a click.
- Never round, truncate, or color a value in a way that changes its meaning.

## 2. Make the consequence visible before the action

Many actions in GrowthBook change production: publishing a Feature Flag, starting an experiment, editing a Saved Group. Before the user commits, show what changes and where.

- Show which environments, Projects, and SDK Connections an action affects.
- Show a diff or preview for changes to live state.
- Match friction to risk. A low-risk edit saves in place. A production change gets a review step. A destructive change gets a confirmation that names the thing being destroyed.
- Make reversible actions easy to undo and irreversible actions hard to trigger by accident.

## 3. Use space efficiently, without crowding

Power users scan many experiments, metrics, and flags at once. Use space efficiently, but leave enough room that the screen stays easy to read. Every element has to earn its place.

- Use tables and compact lists for collections. Use cards only when items need a visual or a summary that a row can't hold.
- Avoid empty space that carries no meaning, such as a wide card holding one value or a modal that's mostly padding. Avoid the opposite too: if a section needs a second look to parse, give it more room or split it.
- Group related controls and separate unrelated ones with spacing, not borders.
- Align numbers to the right and use tabular figures so columns compare at a glance.
- Remove decoration that doesn't carry information: extra borders, icons that repeat a label, color used for style alone.
- Give each screen one primary task. Move secondary actions into menus or secondary pages.

## 4. Let the component speak for itself

A clear label and a familiar control usually explain themselves. Extra text makes a screen look busier and gets skipped.

- Don't add a subtitle or description that restates the heading or label. "Targeting" doesn't need "Configure targeting rules for this Feature Flag" underneath.
- Add helper text only when it says something the label can't: a constraint, a consequence, or a non-obvious default.
- Keep helper text to one short sentence. Link to the docs for anything longer.
- If a control needs a paragraph to explain it, fix the label or the control first.

## 5. Progressive disclosure over upfront complexity

GrowthBook has deep configuration (statistics engines, attribution models, targeting rules). Most users need the defaults most of the time.

- Lead with the decision the user came to make. Put advanced settings behind a clear "Advanced" affordance.
- Use sensible defaults, and show what the default is rather than leaving a field blank.
- Explain a concept where it appears, with helper text or a tooltip, and link to the docs for depth.
- Don't hide anything that changes the result. If a setting affects a number on screen, surface it near that number.

## 6. Consistency beats novelty

A user who learns one part of GrowthBook should already understand the next. Reuse before you invent.

- Use the design system (`@/ui/`) for every control that has an equivalent there. If a pattern is missing and generic, propose it as a new `@/ui/` component instead of a one-off.
- The same concept looks and behaves the same everywhere: a status badge, a metric result, an environment toggle.
- Use the named-resource vocabulary from the copy guide. Call a thing by the same name on every screen.
- Introduce a new pattern only when existing ones fail the task, and design it so other screens can adopt it.

## 7. Color carries meaning

Color in GrowthBook signals state and outcome. Use it sparingly so it stays readable.

- Reserve green and red for outcomes and status (winning or losing, healthy or failing), and pair them with text or an icon so the meaning doesn't depend on color alone.
- Use the violet accent for primary actions and selection, not for decoration.
- Neutral grays do most of the work. If everything is colorful, nothing stands out.
- Design every screen for both light and dark themes.

## 8. Accessible by default

Accessibility is part of the design, not a pass at the end. Every design must meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA. Unlike the efficiency budgets, this is a requirement, not a starting point. The `@/ui/` components are built on Radix, which handles much of the keyboard and screen reader behavior, but layout, color, and copy are up to the design.

The criteria that most often affect GrowthBook designs:

| Area                    | Requirement                                                                                                                                 | WCAG criterion                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Text contrast           | At least 4.5:1, or 3:1 for large text (24 px, or 18.66 px bold).                                                                            | 1.4.3 Contrast (Minimum)                                                         |
| Non-text contrast       | At least 3:1 for control boundaries, focus indicators, icons that carry meaning, and chart elements needed to read the data.                | 1.4.11 Non-text Contrast                                                         |
| Color alone             | Never use color as the only way to convey meaning. Pair status and result colors with text, an icon, or a pattern.                          | 1.4.1 Use of Color                                                               |
| Keyboard                | Every action works with a keyboard alone, and focus never gets trapped.                                                                     | 2.1.1 Keyboard, 2.1.2 No Keyboard Trap                                           |
| Visible focus           | Focus is always visible, and sticky headers, footers, or drawers don't cover the focused element.                                           | 2.4.7 Focus Visible, 2.4.11 Focus Not Obscured (Minimum)                         |
| Target size             | Click targets are at least 24 × 24 CSS px, or have enough spacing that a 24 px circle around each doesn't overlap another target.           | 2.5.8 Target Size (Minimum)                                                      |
| Dragging                | Anything done by dragging, such as reordering rules or resizing columns, also has a single-click alternative.                               | 2.5.7 Dragging Movements                                                         |
| Hover and focus content | Tooltips and popovers can be dismissed without moving the pointer, stay open while the pointer is over them, and don't vanish on their own. | 1.4.13 Content on Hover or Focus                                                 |
| Zoom and reflow         | Content works at 200% zoom and reflows at 320 CSS px wide without horizontal scrolling. Data tables and charts are exempt from reflow.      | 1.4.4 Resize Text, 1.4.10 Reflow                                                 |
| Labels and errors       | Every input has a visible label. Errors name the field and say how to fix it.                                                               | 3.3.1 Error Identification, 3.3.2 Labels or Instructions, 3.3.3 Error Suggestion |
| Redundant entry         | Don't ask for information the user already entered in the same flow. Prefill it or let them select it.                                      | 3.3.7 Redundant Entry                                                            |
| Names and roles         | Icon-only buttons and custom controls have an accessible name that matches their visible purpose.                                           | 4.1.2 Name, Role, Value, 2.5.3 Label in Name                                     |
| Non-text content        | Charts and meaningful images have a text alternative. For charts, give a text or table equivalent of the key values.                        | 1.1.1 Non-text Content                                                           |

Beyond the minimum:

- Don't put essential information only in a tooltip or on hover.
- Respect reduced-motion settings for animations and transitions.
- Check every design in both light and dark themes. Contrast must pass in each.

## 9. Plan every state

A design is incomplete until it covers the states real data produces.

- Design the empty state, the loading state, the error state, the permission-denied state, and the state with one item and with thousands.
- Design for long names, missing values, and extreme numbers.
- Show the commercial-feature state: what a user on a plan without the feature sees, and how they learn what it unlocks.
- Tell the user what to do next in empty and error states, not just what went wrong.

## 10. Respect the user's time

Users come to GrowthBook to get something done and get back to their work.

- Keep the path to the common task short. Count the clicks and remove the ones that don't add a decision.
- Preserve context. Keep filters, scroll position, and unsaved input when the user navigates away and back.
- Give immediate feedback for every action, and say plainly when something succeeds or fails.
- Make URLs shareable. A link to a view should reproduce what the sender saw.

## Using these principles

When two principles conflict, earlier principles win: trust and safety outweigh density, and efficient use of space outweighs novelty. If a design breaks a principle on purpose, say which one and why in the design notes or the PR description.
