import type { recordOptions } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import type { SessionReplayUrlScrubberConfig } from "./url-scrub";

export type { SessionReplayUrlScrubberConfig } from "./url-scrub";

/**
 * Privacy controls for the session-replay plugin. Deny-by-default:
 * `maskAllInputs` is true unless explicitly disabled.
 *
 * Element-level privacy layers, all composed together:
 *   1. Shipped classes: gb-block (opaque rectangle), gb-mask (text →
 *      asterisks), gb-ignore (events not recorded)
 *   2. Shipped data attributes: data-gb-block/-mask/-ignore, plus
 *      data-gb-allow to opt an element back into raw capture (escapes
 *      masking only — block/ignore have no escape hatch)
 *   3. Customer CSS selectors (blockSelector/maskTextSelector/
 *      ignoreSelector) — additive with the shipped ones
 *   4. Custom maskInputFn/maskTextFn for shape-preserving redaction
 */
export type SessionReplayPrivacyConfig = {
  // Mask all input fields (default true). Disabling flips masking to
  // opt-in, where one untagged credit-card field leaks card numbers.
  maskAllInputs?: boolean;
  // When maskAllInputs is false, the per-input-type allowlist of which
  // types ARE masked (e.g. { password: true, email: true })
  maskInputOptions?: Partial<Record<MaskableInputType, boolean>>;
  // Extra CSS selector for elements to block (opaque rectangle); composes
  // with the default `[data-gb-block], .gb-block`
  blockSelector?: string;
  // Extra CSS selector for text masking; composes with `[data-gb-mask], .gb-mask`
  maskTextSelector?: string;
  // Extra CSS selector for elements whose input events aren't recorded
  // (rendering unaffected — use blockSelector for that); composes with
  // `[data-gb-ignore], .gb-ignore`
  ignoreSelector?: string;
  // Custom input masking (e.g. shape-preserving last-4). Return the value to
  // record; `data-gb-allow` ancestors bypass it entirely.
  maskInputFn?: (text: string, el: HTMLElement | null) => string;
  // Custom text masking; wrapped the same way as maskInputFn
  maskTextFn?: (text: string, el: HTMLElement | null) => string;
  // Called when rrweb itself throws while capturing (usually survivable);
  // useful to wire into customer error tracking
  errorHandler?: (err: unknown) => void;
  // URL scrubbing knobs (see SessionReplayUrlScrubberConfig)
  url?: SessionReplayUrlScrubberConfig;
};

export type MaskableInputType =
  | "color"
  | "date"
  | "datetime-local"
  | "email"
  | "month"
  | "number"
  | "range"
  | "search"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week"
  | "textarea"
  | "select"
  | "password";

// Exported so docs and customer code reference the same literals
export const GB_BLOCK_CLASS = "gb-block";
export const GB_MASK_CLASS = "gb-mask";
export const GB_IGNORE_CLASS = "gb-ignore";
export const GB_BLOCK_ATTR = "data-gb-block";
export const GB_MASK_ATTR = "data-gb-mask";
export const GB_IGNORE_ATTR = "data-gb-ignore";
export const GB_ALLOW_ATTR = "data-gb-allow";

const DEFAULT_BLOCK_SELECTOR = `[${GB_BLOCK_ATTR}], .${GB_BLOCK_CLASS}`;
const DEFAULT_MASK_TEXT_SELECTOR = `[${GB_MASK_ATTR}], .${GB_MASK_CLASS}`;
const DEFAULT_IGNORE_SELECTOR = `[${GB_IGNORE_ATTR}], .${GB_IGNORE_CLASS}`;

type RrwebPrivacyOptions = Pick<
  recordOptions<eventWithTime>,
  | "blockClass"
  | "blockSelector"
  | "maskTextClass"
  | "maskTextSelector"
  | "ignoreClass"
  | "ignoreSelector"
  | "maskAllInputs"
  | "maskInputOptions"
  | "maskInputFn"
  | "maskTextFn"
  | "errorHandler"
>;

// Customer selectors add to the shipped defaults, never replace them
function composeSelectors(
  defaultSelector: string,
  customerSelector?: string,
): string {
  if (!customerSelector) return defaultSelector;
  return `${defaultSelector}, ${customerSelector}`;
}

// data-gb-allow on the element or an ancestor bypasses masking entirely;
// otherwise the customer's mask fn, else rrweb's length-preserving asterisks
function buildMaskFn(
  userMaskFn: ((text: string, el: HTMLElement | null) => string) | undefined,
): (text: string, el: HTMLElement | null) => string {
  return (text, el) => {
    if (el?.closest(`[${GB_ALLOW_ATTR}]`)) return text;
    if (userMaskFn) return userMaskFn(text, el);
    return "*".repeat(text.length);
  };
}

export function buildRrwebPrivacyOptions(
  privacy: SessionReplayPrivacyConfig = {},
): RrwebPrivacyOptions {
  return {
    blockClass: GB_BLOCK_CLASS,
    blockSelector: composeSelectors(
      DEFAULT_BLOCK_SELECTOR,
      privacy.blockSelector,
    ),
    maskTextClass: GB_MASK_CLASS,
    maskTextSelector: composeSelectors(
      DEFAULT_MASK_TEXT_SELECTOR,
      privacy.maskTextSelector,
    ),
    ignoreClass: GB_IGNORE_CLASS,
    ignoreSelector: composeSelectors(
      DEFAULT_IGNORE_SELECTOR,
      privacy.ignoreSelector,
    ),
    maskAllInputs: privacy.maskAllInputs ?? true,
    maskInputOptions: privacy.maskInputOptions,
    maskInputFn: buildMaskFn(privacy.maskInputFn),
    maskTextFn: buildMaskFn(privacy.maskTextFn),
    errorHandler: privacy.errorHandler,
  };
}
