import { ExperimentPhaseStringDates } from "shared/types/experiment";
import React, { ReactNode } from "react";
import qs from "query-string";
import { getEqualWeights } from "shared/experiments";
import {
  BrowserCookieStickyBucketService,
  Context,
  GrowthBook,
} from "@growthbook/growthbook-react";
import Cookies from "js-cookie";
import { v4 as uuidv4 } from "uuid";
import { AccountPlan } from "shared/enterprise";
import { AppFeatures } from "@/types/app-features";
import track from "@/services/track";

const DEVICE_ID_COOKIE = "gb_device_id";
const SESSION_ID_COOKIE = "gb_session_id";
const pageIds: Record<string, string> = {};

export const GB_SDK_ID =
  process.env.NODE_ENV === "production"
    ? "sdk-ueFMOgZ2daLa0M"
    : "sdk-UmQ03OkUDAu7Aox";

export const gbContext: Context = {
  apiHost: "https://cdn.growthbook.io",
  clientKey: GB_SDK_ID,
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    track(
      "Experiment Viewed",
      {
        experimentId: experiment.key,
        variationId: result.key,
      },
      true,
    );
  },
  stickyBucketService: new BrowserCookieStickyBucketService({
    jsCookie: Cookies,
  }),
  attributes: {
    session_id: getOrGenerateSessionId(),
    device_id: getOrGenerateDeviceId(),
    page_id: getOrGeneratePageId(),
  },
};
export const growthbook = new GrowthBook<AppFeatures>(gbContext);

export function trafficSplitPercentages(weights: number[]): number[] {
  const sum = weights.reduce((sum, n) => sum + n, 0);
  return weights.map((w) => +((w / sum) * 100));
}

export function formatTrafficSplit(weights: number[], decimals = 0): string {
  return trafficSplitPercentages(weights)
    .map((w) => w.toFixed(decimals))
    .join(" / ");
}

// Get the number of decimals +1 needed to differentiate between
// observed and expected weights
export function getSRMNeededPrecisionP1(
  observed: number[],
  expected: number[],
): number {
  const observedpct = trafficSplitPercentages(observed);
  const expectedpct = trafficSplitPercentages(expected);
  const maxDiff = Math.max(
    ...observedpct.map((o, i) => Math.abs(o - expectedpct[i] || 0)),
  );
  return (maxDiff ? -1 * Math.floor(Math.log10(maxDiff)) : 0) + 1;
}

export function phaseSummary(
  phase: ExperimentPhaseStringDates,
  skipWeights: boolean = false,
): ReactNode {
  if (!phase) {
    return null;
  }
  return (
    <>
      <span className="percent-traffic">
        {Math.floor(phase.coverage * 100)}%
      </span>{" "}
      traffic
      {!skipWeights && (
        <>
          ,{" "}
          <span className="split">
            {formatTrafficSplit(phase.variationWeights || [])}
          </span>{" "}
          split
        </>
      )}
    </>
  );
}

export function distributeWeights(
  weights: number[],
  customSplit: boolean,
): number[] {
  // Always just use equal weights if we're not customizing them
  if (!customSplit) return getEqualWeights(weights.length);

  // Get current sum and distribute the difference equally so it adds to 1
  const sum = weights.reduce((sum, w) => sum + w, 0);
  const diff = (sum - 1) / weights.length;
  const newWeights = weights.map((w) => floatRound(w - diff));

  // With rounding, the end result might be slightly off and need an adjustment
  const adjustment = floatRound(newWeights.reduce((sum, w) => sum + w, -1));
  if (adjustment) {
    const i = newWeights.findIndex((w) => w >= adjustment);
    if (i >= 0) {
      newWeights[i] = floatRound(newWeights[i] - adjustment);
    }
  }

  return newWeights;
}

export function percentToDecimalForNumber(
  val: number,
  precision: number = 4,
): number {
  return parseFloat((val / 100).toFixed(precision));
}

export function percentToDecimal(val: string, precision: number = 4): number {
  return parseFloat((parseFloat(val) / 100).toFixed(precision));
}
export function decimalToPercent(val: number, precision: number = 4): number {
  return parseFloat((val * 100).toFixed(precision - 2));
}
export function floatRound(val: number, precision: number = 4): number {
  return parseFloat(val.toFixed(precision));
}

// Updates one of the variation weights and rebalances
// the rest of the weights to keep the sum equal to 1
export function rebalance(
  weights: number[],
  i: number,
  newValue: number,
  precision: number = 4,
): number[] {
  // Clamp new value
  if (newValue > 1) newValue = 1;
  if (newValue < 0) newValue = 0;

  // Update the new value
  weights = [...weights];
  weights[i] = newValue;

  // Current sum of weights
  const currentTotal = floatRound(
    weights.reduce((sum, w) => sum + w, 0),
    precision,
  );
  // The sum is too low, increment the next variation's weight
  if (currentTotal < 1) {
    const nextIndex = (i + 1) % weights.length;
    const nextValue = floatRound(weights[nextIndex], precision);
    weights[(i + 1) % weights.length] = floatRound(
      nextValue + (1 - currentTotal),
      precision,
    );
  } else if (currentTotal > 1) {
    // The sum is too high, loop through the other variations and decrement weights
    let overage = floatRound(currentTotal - 1, precision);
    let j = 1;
    while (overage > 0 && j < weights.length) {
      const nextIndex = (j + i) % weights.length;
      const nextValue = floatRound(weights[nextIndex], precision);
      const adjustedValue =
        nextValue >= overage ? floatRound(nextValue - overage, precision) : 0;
      overage = floatRound(overage - (nextValue - adjustedValue), precision);
      weights[nextIndex] = adjustedValue;
      j++;
    }
  }

  return weights;
}

export function isNullUndefinedOrEmpty(x): boolean {
  if (x === null) return true;
  if (x === undefined) return true;
  if (x === "") return true;
  if (typeof x === "object" && !Object.keys(x).length) return true;
  return false;
}

export function appendQueryParamsToURL(
  url: string,
  params: Record<string, string | number | undefined>,
): string {
  const [_root, hash] = url.split("#");
  const [root, query] = _root.split("?");
  const parsed = qs.parse(query ?? "");
  const queryParams = qs.stringify(
    { ...parsed, ...params },
    {
      sort: false,
    },
  );
  return `${root}?${queryParams}${hash ? `#${hash}` : ""}`;
}

export function capitalizeFirstLetter(string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export function capitalizeWords(string): string {
  return string
    .split(" ")
    .map((word) => capitalizeFirstLetter(word))
    .join(" ");
}

function getOrGenerateDeviceId() {
  const deviceId = Cookies.get(DEVICE_ID_COOKIE) || uuidv4();
  Cookies.set(DEVICE_ID_COOKIE, deviceId, {
    expires: 365,
    sameSite: "strict",
  });
  return deviceId;
}

export function getOrGeneratePageId() {
  if (typeof window === "undefined") {
    return "";
  }

  // On initial load if the router hasn't initialized a state change yet then history.state will be null.
  // Since this only happens on one pageload, using a hardcoded default key should still work as its own key
  const pageIdKey = window.history.state?.key || "";
  if (!(pageIdKey in pageIds)) {
    pageIds[pageIdKey] = uuidv4();
  }
  return pageIds[pageIdKey];
}

function getOrGenerateSessionId() {
  const sessionId = Cookies.get(SESSION_ID_COOKIE) || uuidv4();
  const now = new Date();
  Cookies.set(SESSION_ID_COOKIE, sessionId, {
    expires: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes() + 30,
      now.getSeconds(),
    ),
    sameSite: "strict",
  });
  return sessionId;
}

// Used to describe account plan in text
export function planNameFromAccountPlan(accountPlan?: AccountPlan) {
  if (!accountPlan) {
    return "Premium";
  }

  if (accountPlan === "pro_sso" || accountPlan === "pro") {
    return "Pro";
  }

  if (accountPlan === "oss" || accountPlan === "starter") {
    return "Starter";
  }

  if (accountPlan === "enterprise") {
    return "Enterprise";
  }

  return capitalizeFirstLetter(accountPlan);
}
