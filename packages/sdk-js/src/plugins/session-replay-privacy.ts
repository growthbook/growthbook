import type { recordOptions } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import type { SessionReplayUrlScrubberConfig } from "./session-replay-url-scrub";

export type { SessionReplayUrlScrubberConfig } from "./session-replay-url-scrub";

/**
 * Privacy controls for the session-replay SDK plugin.
 *
 * Element-level privacy is layered:
 *
 *   1. GrowthBook's shipped CLASSES (the simplest API — slap one on):
 *      - class="gb-block"  → element captured as opaque rectangle
 *      - class="gb-mask"   → text content replaced with asterisks
 *      - class="gb-ignore" → events on element are not recorded
 *
 *   2. GrowthBook's shipped DATA ATTRIBUTES (cleaner in component
 *      libraries that already use data-* conventions):
 *      - data-gb-block  → same as gb-block
 *      - data-gb-mask   → same as gb-mask
 *      - data-gb-ignore → same as gb-ignore
 *      - data-gb-allow  → opt this element (and its descendants) BACK
 *        into raw capture even if maskAllInputs / maskTextSelector
 *        would otherwise mask it. Only affects mask, NOT block or
 *        ignore — those are hard guardrails with no escape hatch.
 *
 *   3. Customer-supplied CSS selectors via `blockSelector` /
 *      `maskTextSelector` / `ignoreSelector`. Composed with the
 *      GrowthBook defaults — your selectors ADD to ours, they don't
 *      replace them.
 *
 *   4. Custom `maskInputFn` / `maskTextFn` for shape-preserving or
 *      hash-based redaction. Layered under the data-gb-allow check —
 *      yours runs only when the element isn't opted in via data-gb-allow.
 *
 * Defaults are deny-by-default: `maskAllInputs` is true unless
 * explicitly disabled. rrweb's built-in default masking (length-
 * preserved asterisks) is used unless you supply custom mask functions.
 */
export type SessionReplayPrivacyConfig = {
  /**
   * Mask all input fields by default. STRONGLY recommended — it's the
   * difference between an opt-in masking model (one CC field that wasn't
   * tagged leaks card numbers) and an opt-out model (you have to
   * explicitly allowlist non-sensitive inputs).
   *
   * Default: true.
   */
  maskAllInputs?: boolean;

  /**
   * When `maskAllInputs` is false, this is the per-input-type allowlist
   * for which types ARE masked. Ignored when `maskAllInputs` is true
   * (every input is masked regardless).
   *
   * Example: { password: true, email: true } — only password and email
   * inputs are masked, all other input types render their values in the
   * replay.
   */
  maskInputOptions?: Partial<Record<MaskableInputType, boolean>>;

  /**
   * Additional CSS selector for elements to block (capture as opaque
   * rectangle). Composes with the default `[data-gb-block], .gb-block`
   * — elements matching EITHER are blocked.
   */
  blockSelector?: string;

  /**
   * Additional CSS selector for text masking. Composes with the default
   * `[data-gb-mask], .gb-mask`.
   */
  maskTextSelector?: string;

  /**
   * Additional CSS selector for elements whose input events are ignored.
   * Composes with the default `[data-gb-ignore], .gb-ignore`. Note: this
   * suppresses event RECORDING for the element, not its rendering — use
   * `blockSelector` to redact rendering.
   */
  ignoreSelector?: string;

  /**
   * Custom input masking function. Called by rrweb with the input's
   * current value and the element. Return the value to record. Useful
   * for preserving shape (e.g. last-4-of-CC) or hashing while still
   * masking.
   *
   * GrowthBook wraps your function: `data-gb-allow` ancestors bypass
   * yours entirely (raw value recorded), so you don't need to handle
   * that case.
   */
  maskInputFn?: (text: string, el: HTMLElement | null) => string;

  /**
   * Custom text masking function. Called by rrweb with the text node's
   * content and parent element. Return the value to record. Wrapped the
   * same way as `maskInputFn`.
   */
  maskTextFn?: (text: string, el: HTMLElement | null) => string;

  /**
   * rrweb internal error handler. Called when rrweb itself throws while
   * capturing — typically harmless (rrweb survives and continues), but
   * useful to wire into customer Sentry for visibility.
   */
  errorHandler?: (err: unknown) => void;

  /**
   * URL scrubbing config. URLs that leave the browser are deny-by-default:
   * all query params stripped unless allowlisted, ID-like path segments
   * replaced with `[id]`, fragments dropped. Set knobs here to tune.
   */
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

/**
 * GrowthBook's shipped privacy class names + data attributes. These are
 * the customer-facing surface for element-level privacy — slap one of
 * these on the element and the SDK does the right thing. The constants
 * are exported so docs and customer code reference the same literals.
 */
export const GB_BLOCK_CLASS = "gb-block";
export const GB_MASK_CLASS = "gb-mask";
export const GB_IGNORE_CLASS = "gb-ignore";
export const GB_BLOCK_ATTR = "data-gb-block";
export const GB_MASK_ATTR = "data-gb-mask";
export const GB_IGNORE_ATTR = "data-gb-ignore";
export const GB_ALLOW_ATTR = "data-gb-allow";

// Default selectors that catch the data-attribute form alongside the
// class form. Customer-supplied selectors get appended, so they ADD to
// the defaults rather than replacing them.
const DEFAULT_BLOCK_SELECTOR = `[${GB_BLOCK_ATTR}], .${GB_BLOCK_CLASS}`;
const DEFAULT_MASK_TEXT_SELECTOR = `[${GB_MASK_ATTR}], .${GB_MASK_CLASS}`;
const DEFAULT_IGNORE_SELECTOR = `[${GB_IGNORE_ATTR}], .${GB_IGNORE_CLASS}`;

/**
 * Subset of `rrweb`'s `recordOptions` that this module produces. Anything
 * outside the privacy domain (e.g. emit, sampling, checkoutEveryNms) is
 * the plugin's responsibility, not this module's.
 */
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

/**
 * Compose a customer-supplied selector with our default. Either may be
 * absent. Returns a comma-separated CSS selector list, or undefined when
 * neither is set (rrweb treats absent as "match nothing").
 */
function composeSelectors(
  defaultSelector: string,
  customerSelector?: string,
): string {
  if (!customerSelector) return defaultSelector;
  return `${defaultSelector}, ${customerSelector}`;
}

/**
 * Build a mask function that bypasses masking when the element (or any
 * ancestor) carries the `data-gb-allow` attribute. Wraps the customer's
 * own mask function if provided; otherwise falls back to rrweb's standard
 * length-preserved asterisks.
 */
function buildMaskFn(
  userMaskFn: ((text: string, el: HTMLElement | null) => string) | undefined,
): (text: string, el: HTMLElement | null) => string {
  return (text, el) => {
    if (el && typeof el.closest === "function") {
      if (el.closest(`[${GB_ALLOW_ATTR}]`)) {
        return text;
      }
    }
    if (userMaskFn) return userMaskFn(text, el);
    // Match rrweb's default asterisk-fill so opt-out behavior is
    // consistent whether or not a custom mask fn is supplied.
    return "*".repeat(text.length);
  };
}

/**
 * Translate a SessionReplayPrivacyConfig into rrweb's `record()` options.
 * The GrowthBook-shipped class names and data attributes are always
 * honored; customer-supplied selectors and mask functions compose with
 * (not replace) those defaults.
 */
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
