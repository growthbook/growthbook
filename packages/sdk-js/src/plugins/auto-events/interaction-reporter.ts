import type { GrowthBook } from "../../GrowthBook";
import { DEFAULT_SAMPLING_SEED, shouldSample } from "../utils/sampling";
import { detectEnv } from "../utils/browser";
import {
  composeSelectors,
  DEFAULT_ALLOW_SELECTOR,
  DEFAULT_BLOCK_SELECTOR,
  DEFAULT_IGNORE_SELECTOR,
  DEFAULT_MASK_SELECTOR,
  resolvePrivacySettings,
  type PrivacySettings,
} from "../utils/privacy";
import {
  resolveElement,
  shouldIgnore,
  getElementProperties,
  getClickEventName,
  getFormActionProperties,
  cleanProperties,
  type ElementPropertyOptions,
} from "./element-utils";
import { createPageState, type PageState } from "./page-state";

const DEFAULT_CLICK_SELECTOR =
  "a, button, [role='button'], [role='link'], " +
  "input[type='submit'], input[type='button'], [data-gb-track]";
// Rage click: this many clicks within the window, all within this radius
const RAGE_THRESHOLD = 3;
const RAGE_WINDOW_MS = 3000;
const RAGE_MAX_DISTANCE_PX = 50;
const PASSWORD_SELECTOR = "input[type='password']";

export type InteractionReporterSettings = {
  samplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  clickSelector?: string;
  collectElementText?: boolean;
  formSelector?: string;
  privacy?: PrivacySettings;
  // Shared with the engagement reporter of the same instance
  pageState?: PageState;
  growthbook: GrowthBook;
};

export function createInteractionReporter({
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  clickSelector = DEFAULT_CLICK_SELECTOR,
  collectElementText = true,
  formSelector = "form",
  privacy,
  pageState,
  growthbook,
}: InteractionReporterSettings) {
  if (detectEnv() !== "browser") return;
  samplingRate = Math.min(1, Math.max(0, samplingRate));
  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: samplingSeed ?? DEFAULT_SAMPLING_SEED,
    })
  )
    return;

  const {
    incrementClickCount,
    incrementTrackedClickCount,
    incrementRageClickCount,
    incrementFormSubmitCount,
    markInteractionTrackingActive,
    markInteractionTrackingInactive,
  } = pageState ?? createPageState();

  // Resolved per event so settings another plugin registers later still apply
  function currentPrivacy(): {
    ignoreSelector: string;
    elOpts: ElementPropertyOptions;
  } {
    const p = resolvePrivacySettings({}, privacy);
    return {
      ignoreSelector: composeSelectors(
        DEFAULT_IGNORE_SELECTOR,
        p.ignoreSelector,
      ),
      elOpts: {
        collectText: collectElementText,
        maskSelector: composeSelectors(
          DEFAULT_BLOCK_SELECTOR,
          DEFAULT_MASK_SELECTOR,
          PASSWORD_SELECTOR,
          p.blockSelector,
          p.maskTextSelector,
        ),
        allowSelector: composeSelectors(
          DEFAULT_ALLOW_SELECTOR,
          p.allowSelector,
        ),
        url: p.url,
      },
    };
  }

  let rageClicks: { time: number; x: number; y: number }[] = [];
  const maxDistSq = RAGE_MAX_DISTANCE_PX * RAGE_MAX_DISTANCE_PX;

  function handleRageClick(
    event: MouseEvent,
    target: Element,
    elOpts: ElementPropertyOptions,
  ) {
    const now = performance.now();
    const click = { time: now, x: event.clientX, y: event.clientY };
    rageClicks = rageClicks.filter((c) => now - c.time <= RAGE_WINDOW_MS);
    rageClicks.push(click);

    for (const origin of rageClicks) {
      let nearby = 0;
      for (const c of rageClicks) {
        const dx = origin.x - c.x;
        const dy = origin.y - c.y;
        if (dx * dx + dy * dy <= maxDistSq) nearby++;
      }
      if (nearby >= RAGE_THRESHOLD) {
        incrementRageClickCount();
        growthbook.logEvent("rage_click", {
          click_count: nearby,
          origin_x: Math.round(origin.x),
          origin_y: Math.round(origin.y),
          latest_x: Math.round(click.x),
          latest_y: Math.round(click.y),
          ...getElementProperties(target, elOpts),
        });
        rageClicks = [];
        return;
      }
    }
  }

  const onClick = (event: MouseEvent) => {
    const target = resolveElement(event.target);
    if (!target) return;

    incrementClickCount();

    const { ignoreSelector, elOpts } = currentPrivacy();
    if (shouldIgnore(target, ignoreSelector)) return;

    handleRageClick(event, target, elOpts);

    const tracked = target.closest(clickSelector);
    if (!tracked) return;

    incrementTrackedClickCount();
    growthbook.logEvent(getClickEventName(tracked), {
      ...getElementProperties(tracked, elOpts),
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
    });
  };

  const onSubmit = (event: Event) => {
    const form = resolveElement(event.target);
    if (!form || !form.matches(formSelector)) return;
    const { ignoreSelector, elOpts } = currentPrivacy();
    if (shouldIgnore(form, ignoreSelector)) return;

    incrementFormSubmitCount();
    const submitter = resolveElement((event as SubmitEvent).submitter);
    growthbook.logEvent(
      "form_submit",
      cleanProperties({
        form_id: form.getAttribute("id") || undefined,
        form_name: form.getAttribute("name") || undefined,
        form_method: form.getAttribute("method") || "get",
        ...getFormActionProperties(form as HTMLFormElement, elOpts.url),
        submitter: submitter
          ? getElementProperties(submitter, elOpts)
          : undefined,
      }),
    );
  };

  markInteractionTrackingActive();
  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("submit", onSubmit, { capture: true });

  growthbook.onDestroy(() => {
    markInteractionTrackingInactive();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
    rageClicks = [];
  });
}
