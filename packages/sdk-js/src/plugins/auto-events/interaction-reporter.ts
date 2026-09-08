import type { GrowthBook } from "../../GrowthBook";
import { shouldSample } from "../utils/sampling";
import { detectEnv } from "../utils/browser";
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
const DEFAULT_IGNORE_CLICK_SELECTOR =
  "[data-gb-ignore], [data-gb-ignore-clicks], .gb-ignore";
const DEFAULT_IGNORE_FORM_SELECTOR =
  "[data-gb-ignore], [data-gb-ignore-forms], .gb-ignore";
const IGNORE_RAGE_SELECTOR = "[data-gb-ignore-rage]";
// Rage click: this many clicks within the window, all within this radius
const RAGE_THRESHOLD = 3;
const RAGE_WINDOW_MS = 3000;
const RAGE_MAX_DISTANCE_PX = 50;
const DEFAULT_SENSITIVE_SELECTOR =
  "input[type='password'], [data-gb-sensitive]";

export type InteractionReporterSettings = {
  samplingRate?: number;
  hashAttribute?: string;
  samplingSeed?: string;
  clickSelector?: string;
  ignoreClickSelector?: string;
  collectElementText?: boolean;
  sensitiveSelector?: string;
  formSelector?: string;
  ignoreFormSelector?: string;
  // Shared with the engagement reporter of the same instance
  pageState?: PageState;
  growthbook: GrowthBook;
};

export function createInteractionReporter({
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  clickSelector = DEFAULT_CLICK_SELECTOR,
  ignoreClickSelector = DEFAULT_IGNORE_CLICK_SELECTOR,
  collectElementText = true,
  sensitiveSelector = DEFAULT_SENSITIVE_SELECTOR,
  formSelector = "form",
  ignoreFormSelector = DEFAULT_IGNORE_FORM_SELECTOR,
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
      seed: samplingSeed ?? "interaction-sampling",
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

  const elOpts: ElementPropertyOptions = {
    collectText: collectElementText,
    sensitiveSelector,
  };

  let rageClicks: { time: number; x: number; y: number }[] = [];
  const maxDistSq = RAGE_MAX_DISTANCE_PX * RAGE_MAX_DISTANCE_PX;

  function handleRageClick(event: MouseEvent, target: Element) {
    if (shouldIgnore(target, ignoreClickSelector)) return;
    if (shouldIgnore(target, IGNORE_RAGE_SELECTOR)) return;

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

    handleRageClick(event, target);

    if (shouldIgnore(target, ignoreClickSelector)) return;
    const tracked = target.closest(clickSelector);
    if (!tracked) return;
    if (shouldIgnore(tracked, ignoreClickSelector)) return;

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
    if (shouldIgnore(form, ignoreFormSelector)) return;

    incrementFormSubmitCount();
    const submitter = resolveElement((event as SubmitEvent).submitter);
    growthbook.logEvent(
      "form_submit",
      cleanProperties({
        form_id: form.getAttribute("id") || undefined,
        form_name: form.getAttribute("name") || undefined,
        form_method: form.getAttribute("method") || "get",
        ...getFormActionProperties(form as HTMLFormElement),
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
