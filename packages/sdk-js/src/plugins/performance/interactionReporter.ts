import type { GrowthBook } from "../../GrowthBook";
import { detectEnv, shouldSample } from "./util";
import {
  resolveElement,
  shouldIgnore,
  getElementProperties,
  getClickEventName,
  getFormActionProperties,
  cleanProperties,
  type ElementPropertyOptions,
} from "./elementUtils";
import {
  incrementClickCount,
  incrementTrackedClickCount,
  incrementRageClickCount,
  incrementFormSubmitCount,
} from "./pageState";

const DEFAULT_CLICK_SELECTOR =
  "a, button, [role='button'], [role='link'], " +
  "input[type='submit'], input[type='button'], [data-gb-track]";
const DEFAULT_IGNORE_SELECTOR = "[data-gb-ignore], .gb-ignore";
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
  // rage click
  rageThreshold?: number;
  rageTimeWindowMs?: number;
  rageMaxDistancePx?: number;
  // forms
  formSelector?: string;
  ignoreFormSelector?: string;
  growthbook: GrowthBook;
};

export function createInteractionReporter({
  samplingRate = 1,
  hashAttribute = "id",
  samplingSeed,
  clickSelector = DEFAULT_CLICK_SELECTOR,
  ignoreClickSelector = DEFAULT_IGNORE_SELECTOR,
  collectElementText = true,
  sensitiveSelector = DEFAULT_SENSITIVE_SELECTOR,
  rageThreshold = 3,
  rageTimeWindowMs = 3000,
  rageMaxDistancePx = 50,
  formSelector = "form",
  ignoreFormSelector = DEFAULT_IGNORE_SELECTOR,
  growthbook,
}: InteractionReporterSettings) {
  if (detectEnv() !== "browser") return;
  if (samplingRate < 0 || samplingRate > 1)
    throw new Error("samplingRate must be between 0 and 1");
  if (
    !shouldSample({
      rate: samplingRate,
      hashAttribute,
      attributes: growthbook.getAttributes(),
      seed: samplingSeed ?? "interaction-sampling",
    })
  )
    return;

  const elOpts: ElementPropertyOptions = {
    collectText: collectElementText,
    sensitiveSelector,
  };

  // Rage click state
  let rageClicks: { time: number; x: number; y: number }[] = [];
  const maxDistSq = rageMaxDistancePx * rageMaxDistancePx;

  function handleRageClick(event: MouseEvent, target: Element) {
    if (shouldIgnore(target, ignoreClickSelector)) return;

    const now = performance.now();
    const click = { time: now, x: event.clientX, y: event.clientY };
    rageClicks = rageClicks.filter((c) => now - c.time <= rageTimeWindowMs);
    rageClicks.push(click);

    for (const origin of rageClicks) {
      let nearby = 0;
      for (const c of rageClicks) {
        const dx = origin.x - c.x;
        const dy = origin.y - c.y;
        if (dx * dx + dy * dy <= maxDistSq) nearby++;
      }
      if (nearby >= rageThreshold) {
        incrementRageClickCount();
        growthbook.logEvent("rage_click", {
          click_count: nearby,
          threshold: rageThreshold,
          time_window_ms: rageTimeWindowMs,
          max_distance_px: rageMaxDistancePx,
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

    if (rageThreshold > 0) handleRageClick(event, target);

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

  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("submit", onSubmit, { capture: true });

  growthbook.onDestroy(() => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
    rageClicks = [];
  });
}
