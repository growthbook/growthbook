/**
 * The one size vocabulary for @/ui.
 *
 * Every component's size prop uses these names. None takes Radix numbers
 * ("1".."9") or words ("small", "medium") any more.
 */
export type TshirtSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * Declare the subset of the ladder one component supports.
 *
 *   size?: Size<"sm" | "md">
 *
 * Components support subsets, never renamings. Adding a step to a component is
 * a one-word change here. Changing what a step MEANS is a change to
 * RADIX_SIZE below, and it moves every component at the same time.
 *
 * Prefer this over Extract<TshirtSize, ...>, which silently yields never when
 * you typo a name. Size<"smal"> is a compile error.
 */
export type Size<S extends TshirtSize> = S;

/**
 * The shared control scale: Radix's own 1-4 steps.
 *
 * xs and 2xl are deliberately absent, because neither has a shared meaning.
 * Radix has no step below "1", so a component offering xs synthesizes it (Badge
 * is the only one). Nothing but Heading's type scale reaches 2xl. Both names
 * live in the vocabulary so the naming stays uniform; a component that uses one
 * maps it itself.
 */
const RADIX_SIZE = {
  sm: "1",
  md: "2",
  lg: "3",
  xl: "4",
} as const;

export type ScaledSize = keyof typeof RADIX_SIZE;

/**
 * Map a t-shirt size to its Radix step.
 *
 * The literal return type is the guard. Passing the result into a Radix
 * primitive fails to compile when the primitive has no such step, so a
 * component cannot advertise a size it is unable to render. Radix Callout
 * stops at "3", so widening a Callout to Size<"sm" | "md" | "xl"> is a type
 * error at the passthrough, not a visual surprise at runtime.
 *
 * When a component needs a step its primitive lacks, do not reach for a cast.
 * Handle that one step in the component and say why, the way Tabs and Switch
 * synthesize lg on primitives that stop at Radix "2". Do not add a step to
 * TshirtSize to serve a single component.
 */
export function radixSize<S extends ScaledSize>(
  size: S,
): (typeof RADIX_SIZE)[S] {
  return RADIX_SIZE[size];
}
