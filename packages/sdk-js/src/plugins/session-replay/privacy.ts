// Maps the shared privacy settings onto rrweb's record options. Deny by
// default: every input is masked unless maskAllInputs is false.
import type { recordOptions } from "rrweb";
import type { eventWithTime } from "@rrweb/types";
import {
  composeSelectors,
  DEFAULT_ALLOW_SELECTOR,
  DEFAULT_BLOCK_SELECTOR,
  DEFAULT_IGNORE_SELECTOR,
  DEFAULT_MASK_SELECTOR,
  GB_BLOCK_CLASS,
  GB_IGNORE_CLASS,
  GB_MASK_CLASS,
  type PrivacySettings,
} from "../utils/privacy";

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

type MaskFn = (text: string, el: HTMLElement | null) => string;

export type SessionReplayPrivacySettings = PrivacySettings & {
  // When maskAllInputs is false, which input types ARE masked
  // (e.g. { password: true, email: true })
  maskInputOptions?: Partial<Record<MaskableInputType, boolean>>;
  // Shape-preserving redaction (e.g. keep the last 4). gb-allow ancestors
  // bypass it entirely.
  maskInputFn?: MaskFn;
  maskTextFn?: MaskFn;
  // Called when rrweb itself throws while capturing (usually survivable)
  errorHandler?: (err: unknown) => void;
};

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

// gb-allow on the element or an ancestor bypasses masking; otherwise the
// customer's mask fn, else rrweb's length-preserving asterisks
function buildMaskFn(allowSelector: string, userMaskFn?: MaskFn): MaskFn {
  return (text, el) => {
    if (el && el.closest(allowSelector)) return text;
    if (userMaskFn) return userMaskFn(text, el);
    return "*".repeat(text.length);
  };
}

export function buildRrwebPrivacyOptions(
  privacy: SessionReplayPrivacySettings = {},
): RrwebPrivacyOptions {
  const allowSelector = composeSelectors(
    DEFAULT_ALLOW_SELECTOR,
    privacy.allowSelector,
  );
  return {
    blockClass: GB_BLOCK_CLASS,
    blockSelector: composeSelectors(
      DEFAULT_BLOCK_SELECTOR,
      privacy.blockSelector,
    ),
    maskTextClass: GB_MASK_CLASS,
    maskTextSelector: composeSelectors(
      DEFAULT_MASK_SELECTOR,
      privacy.maskTextSelector,
    ),
    ignoreClass: GB_IGNORE_CLASS,
    ignoreSelector: composeSelectors(
      DEFAULT_IGNORE_SELECTOR,
      privacy.ignoreSelector,
    ),
    maskAllInputs: privacy.maskAllInputs ?? true,
    maskInputOptions: privacy.maskInputOptions,
    maskInputFn: buildMaskFn(allowSelector, privacy.maskInputFn),
    maskTextFn: buildMaskFn(allowSelector, privacy.maskTextFn),
    errorHandler: privacy.errorHandler,
  };
}
