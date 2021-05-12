import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

export type TrackingType = "mixpanel" | "ga" | "segment" | "custom";

const fnvHash = `(n)=>{let o=2166136261;const t=n.length;for(let e=0;e<t;e++)o^=n.charCodeAt(e),o+=(o<<1)+(o<<4)+(o<<7)+(o<<8)+(o<<24);return o>>>0}`;

function getUrlCheck(exp: ExperimentInterfaceStringDates): string {
  if (!exp.targetURLRegex) return "";
  const escaped = exp.targetURLRegex.replace(/([^\\])\//g, "$1\\/");
  return `if(!location.href.match(/${escaped}/i)){return}`;
}

function getUserIdCode(t: TrackingType): string {
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
function getTrackingCallback(t: TrackingType, param: string): string {
  if (t === "segment") {
    return `analytics.track("Experiment Viewed",{experimentId: e,variationId: v})`;
  }
  if (t === "mixpanel") {
    return `mixpanel.track("Experiment Viewed",{experimentId: e, variationId: v})`;
  }
  if (t === "ga") {
    return `ga("send","event","experiment",e+"::"+v,{dimension${
      parseInt(param) || "1"
    }:e+"::"+v})`;
  }
  return "\n  // Tracking Callback\n  console.log({experimentId: e, variationId: v})\n";
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
  param: string
): string {
  const n = exp.variations.length;
  const phase = exp.phases?.[0];

  const weights = phase ? phase.variationWeights : new Array(n).fill(1 / n);
  const adjustedWeights = phase
    ? weights.map((w) => w * phase.coverage)
    : weights;

  const cumulativeWeights = [];
  let cw = 0;
  for (let i = 0; i < adjustedWeights.length; i++) {
    cw += adjustedWeights[i];
    cumulativeWeights.push(cw);
  }

  return (
    "<script>" +
    trackingWrap(
      `((u,t) => {${getUrlCheck(exp)}
  const e=${JSON.stringify(exp.trackingKey)},f=${fnvHash},w=${JSON.stringify(
        cumulativeWeights
      )},n=(f(u+e)%1000)/1000;
  let i=0;for(i=0;i<w.length;i++){if(n<w[i])break}
  ${funcs
    .map((f, i) => {
      return `if(i===${i}){${f ? f + ";" : ""}return t(e,i)}`;
    })
    .join("")}
})(${getUserIdCode(tracking)},(e,v)=>{${getTrackingCallback(
        tracking,
        param
      )}})`,
      tracking,
      param
    ) +
    "</script>"
  );
}
