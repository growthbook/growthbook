import type { recordOptions } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import type { SessionReplayUrlScrubberConfig } from "./session-replay-url-scrub";
import type { SessionReplayRegexScrubberConfig } from "./session-replay-regex-scrub";

export type { SessionReplayUrlScrubberConfig } from "./session-replay-url-scrub";
export type { SessionReplayRegexScrubberConfig } from "./session-replay-regex-scrub";

/**
 * Privacy controls for the session-replay SDK plugin.
 *
 * Element-level privacy is handled entirely by GrowthBook's three
 * shipped class names. Customers tag elements with the appropriate
 * class — no SDK configuration required:
 *
 *   - class="gb-block"  → element captured as opaque rectangle
 *   - class="gb-mask"   → text content replaced with asterisks
 *   - class="gb-ignore" → events on element are not recorded
 *
 * The constants `GB_BLOCK_CLASS`, `GB_MASK_CLASS`, and `GB_IGNORE_CLASS`
 * are exported from the plugin so docs and customer code reference the
 * same string literals.
 *
 * `SessionReplayPrivacyConfig` only covers input-masking strategy.
 * Defaults are deny-by-default — `maskAllInputs` is true unless
 * explicitly disabled. rrweb's built-in default masking behavior
 * (length-preserved asterisks) is used for all masked content; custom
 * transform hooks for shape preservation / partial reveals can be
 * exposed in a future iteration if customers ask for them.
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
   * URL scrubbing config. URLs that leave the browser are deny-by-default:
   * all query params stripped unless allowlisted, ID-like path segments
   * replaced with `[id]`, fragments dropped. Set knobs here to tune.
   */
  url?: SessionReplayUrlScrubberConfig;

  /**
   * Pre-transmission regex scrubbing config. A safety net that runs over
   * every event payload before it leaves the browser, replacing things
   * that look like credit cards / SSNs / emails with `[REDACTED]`. Set
   * to `false` to disable entirely (not recommended); pass an object to
   * customize patterns or wire up telemetry.
   */
  regex?: SessionReplayRegexScrubberConfig | false;
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
 * GrowthBook's shipped privacy class names. These are the entire
 * customer-facing surface for element-level privacy — slap one of these
 * on the element and the SDK does the right thing. The constants are
 * exported so docs and customer code reference the same literals.
 */
export const GB_BLOCK_CLASS = "gb-block";
export const GB_MASK_CLASS = "gb-mask";
export const GB_IGNORE_CLASS = "gb-ignore";

/**
 * Subset of `rrweb`'s `recordOptions` that this module produces. Anything
 * outside the privacy domain (e.g. emit, sampling, checkoutEveryNms) is
 * the plugin's responsibility, not this module's.
 */
type RrwebPrivacyOptions = Pick<
  recordOptions<eventWithTime>,
  | "blockClass"
  | "maskTextClass"
  | "ignoreClass"
  | "maskAllInputs"
  | "maskInputOptions"
>;

/**
 * Translate a SessionReplayPrivacyConfig into rrweb's `record()` options.
 * The block/mask/ignore class names are fixed (the GrowthBook convention)
 * and not exposed for override — keeping the customer-facing surface
 * minimal and the documentation tractable.
 */
export function buildRrwebPrivacyOptions(
  privacy: SessionReplayPrivacyConfig = {},
): RrwebPrivacyOptions {
  return {
    blockClass: GB_BLOCK_CLASS,
    maskTextClass: GB_MASK_CLASS,
    ignoreClass: GB_IGNORE_CLASS,
    maskAllInputs: privacy.maskAllInputs ?? true,
    maskInputOptions: privacy.maskInputOptions,
  };
}
