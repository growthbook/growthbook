import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getVariationsForPhase } from "shared/experiments";

export type TrackingType = "mixpanel" | "ga" | "segment" | "custom";

const fnvHash = `(n)=>{let o=2166136261;const t=n.length;for(let e=0;e<t;e++)o^=n.charCodeAt(e),o+=(o<<1)+(o<<4)+(o<<7)+(o<<8)+(o<<24);return o>>>0}`;

export function getUrlRegex(url: string): string {
  return `/${url
    // JSON strigify adds extra escaping for backslashes
    .replace(/\\\\/g, "\\")
    // Need to do this replace twice to catch 2 slahes in a row (e.g. `http://`)
    .replace(/([^\\])\//g, "$1\\/")
    .replace(/([^\\])\//g, "$1\\/")}/i`;
}

function getUrlCheck(exp: ExperimentInterfaceStringDates): string {
  if (!exp.targetURLRegex) return "";
  return `if(!location.href.match(${getUrlRegex(exp.targetURLRegex)})){return}`;
}

export function getUserIdCode(t: TrackingType): string {
  if (t === "segment") {
    return "analytics.user().anonymousId()";
  }
  if (t === "mixpanel") {
    return `mixpanel.get_distinct_id()`;
  }
  if (t === "ga") {
    return `tracker.get('clientId')`;
  }
  return '\n  // User ID\n  "123"\n';
}
export function getTrackingCallback(
  t: TrackingType,
  param: string,
  experimentId = "e",
  variationId = "v",
): string {
  if (t === "segment") {
    return `analytics.track("Experiment Viewed", {
  experimentId: ${experimentId}, 
  variationId: ${variationId}
})`;
  }
  if (t === "mixpanel") {
    return `mixpanel.track("$experiment_started", {
  "Experiment name": ${experimentId},
  "Variant name": ${variationId},
  "$source": "growthbook"
})`;
  }
  if (t === "ga") {
    return `const action = ${experimentId}, label = ${variationId};
ga("send", "event", "experiment", action, label, { 
  dimension${parseInt(param) || "1"}: action + "::" + label
})`;
  }
  return `console.log({
  experimentId: ${experimentId}, 
  variationId: ${variationId}
})`;
}
function trackingWrap(code: string, t: TrackingType, param: string): string {
  if (t === "ga") {
    return `ga(tracker => {${code}})`;
  }
  if (t === "mixpanel" && param) {
    return `mixpanel.init('${param}',{loaded:(mixpanel)=>{${code}}})`;
  }
  return code;
}

export function generateJavascriptSnippet(
  exp: ExperimentInterfaceStringDates,
  funcs: string[],
  tracking: TrackingType,
  param: string,
): string {
  const phase = exp.phases?.[0];
  const n = getVariationsForPhase(exp, null).length;

  const weights = phase ? phase.variationWeights : new Array(n).fill(1 / n);
  const adjustedWeights = phase
    ? weights.map((w) => w * phase.coverage)
    : weights;

  const cumulativeWeights = [];
  let cw = 0;
  for (let i = 0; i < adjustedWeights.length; i++) {
    cw += adjustedWeights[i];
    // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'number' is not assignable to par... Remove this comment to see the full error message
    cumulativeWeights.push(cw);
  }

  return (
    "<script>" +
    trackingWrap(
      `((u,t) => {${getUrlCheck(exp)}
  const e=${JSON.stringify(exp.trackingKey)},f=${fnvHash},w=${JSON.stringify(
    cumulativeWeights,
  )},n=(f(u+e)%1000)/1000;
  let i=0;for(i=0;i<w.length;i++){if(n<w[i])break}
  ${funcs
    .map((f, i) => {
      return `if(i===${i}){${f ? f + ";" : ""}return t(e,i)}`;
    })
    .join("")}
})(${getUserIdCode(tracking)},(e,v)=>{${getTrackingCallback(
        tracking,
        param,
      )}})`,
      tracking,
      param,
    ) +
    "</script>"
  );
}
