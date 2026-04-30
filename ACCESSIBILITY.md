# GrowthBook Accessibility Statement

GrowthBook is committed to making our product usable by as many people as
possible, including users who rely on assistive technology. This statement
describes the current state of accessibility in the GrowthBook web
application and how to report issues.

- [Standard We Target](#standard-we-target)
- [Current Conformance Status](#current-conformance-status)
- [What We Do Well Today](#what-we-do-well-today)
- [Known Gaps](#known-gaps)
- [Reporting an Accessibility Issue](#reporting-an-accessibility-issue)
- [Roadmap](#roadmap)

## Standard We Target

We aim for conformance with [WCAG 2.1 Level AA](https://www.w3.org/TR/WCAG21/),
which is the standard most commonly referenced by Section 508 of the US
Rehabilitation Act and EN 301 549 in the EU. We have not yet completed a
formal audit, so this is a target rather than a certification.

## Current Conformance Status

GrowthBook is **partially conformant** with WCAG 2.1 AA. Partial conformance
means that some parts of the product do not yet fully meet the standard. The
gaps we are aware of are listed below; there are likely others we have not
yet identified.

This statement applies to the GrowthBook web application served from
`packages/front-end` in this repository. SDKs (`packages/sdk-js`,
`packages/sdk-react`) are libraries embedded in customer applications and
are not in scope — accessibility of an SDK-powered experience is determined
by the host application.

## What We Do Well Today

- The GrowthBook design system (`packages/front-end/ui/`) is built on
  [Radix UI](https://www.radix-ui.com/) primitives, which provide
  keyboard navigation, focus management, focus traps in dialogs, and
  appropriate ARIA roles out of the box.
- A "Skip to main content" link is the first focusable element on every
  page so keyboard users can bypass the navigation.
- Modal dialogs expose `role="dialog"`, `aria-modal`, an
  `aria-labelledby` reference to the dialog title, and close on the
  Escape key.
- Icon-only buttons in the design system accept and forward
  `aria-label`.
- The application honors `prefers-reduced-motion` for animations
  inherited from Radix.
- The product does not rely on positive `tabIndex` values, which avoids
  a common source of keyboard-order bugs.

## Known Gaps

We are tracking the following known gaps. This list is not exhaustive.

- Some clickable elements in older code paths use `<div>` or `<a>`
  without `href` instead of `<button>`. These are reachable with a mouse
  but may not be reachable or activatable from the keyboard.
- A small number of `<img>` tags in older components are missing `alt`
  text.
- Form `<label>` elements in legacy code are not always associated with
  their input via `htmlFor`.
- We do not yet run automated accessibility checks (e.g. axe-core or
  `eslint-plugin-jsx-a11y`) in CI, so regressions are not caught
  automatically.
- We have not completed end-to-end testing with major screen readers
  (NVDA, JAWS, VoiceOver) and have not produced a formal VPAT.

## Reporting an Accessibility Issue

We treat accessibility bugs as real bugs. If you encounter a barrier
using GrowthBook, please let us know.

- **GitHub:** [open an issue](https://github.com/growthbook/growthbook/issues/new)
  and add the `accessibility` label

Please include, where possible: the page or feature, the assistive
technology and browser you are using, and what you expected to happen.

## Roadmap

Near-term improvements we plan to make:

1. Add `eslint-plugin-jsx-a11y` to the front-end ESLint config to catch
   missing `alt` text, click handlers on non-interactive elements, and
   unlabeled form fields at lint time.
2. Fix or migrate remaining usages of the legacy `components/Modal.tsx` to the
   Radix-based `@/ui/Dialog`.
3. Run [axe-core](https://github.com/dequelabs/axe-core) against
   representative pages and address findings.
4. Complete a full WCAG 2.1 AA audit and publish a VPAT.

---

_Last reviewed: 2026-04-27._
