import type { GrowthBook } from "../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";
import type {
  InterleaveExposureCallback,
  InterleaveExposureData,
  InterleaveList,
  InterleaveOptions,
  InterleaveResult,
  InterleaveRuleConfig,
} from "../types/growthbook";
import { itemDraft } from "../interleave";
import { hash, toString } from "../util";
import { EVENT_EXPERIMENT_VIEWED } from "../core";

export const EVENT_INTERLEAVE_EXPOSURE = "Interleave Exposure";

// Tracking-key suffix for the measurement-arm user-level experiment
export const MEASUREMENT_EXPERIMENT_SUFFIX = "__measurement";

export type InterleaveArm = "interleaved" | "measurement";

export type InterleavePluginSettings = {
  // Primary exposure contract: one call per impression, no dedupe.
  // Pipe this through your own event pipeline into your warehouse.
  onExposure?: InterleaveExposureCallback;
};

type PluginCapableInstance =
  | GrowthBook
  | UserScopedGrowthBook
  | GrowthBookClient;

const pluginSettings = new WeakMap<object, InterleavePluginSettings>();

// Per-instance dedupe for measurement-arm user-level exposures (one event
// per user per experiment, like core experiment tracking)
const measurementTracked = new WeakMap<object, Set<string>>();

// Registers interleaving on a GrowthBook instance. Registration configures
// the exposure callback; the interleave() call itself also emits through the
// instance's generic event path (logEvent), so the managed-warehouse
// tracking plugin picks exposures up with no extra wiring.
export function interleavePlugin(settings: InterleavePluginSettings = {}) {
  return (gb: PluginCapableInstance) => {
    pluginSettings.set(gb, settings);
  };
}

function realizeList<T>(list: InterleaveList<T>): T[] {
  return typeof list.items === "function" ? list.items() : list.items;
}

function getHashValue(
  attributes: Record<string, unknown>,
  attr?: string,
  fallback?: string,
): { hashAttribute: string; hashValue: string } {
  let hashAttribute = attr || "id";
  let hashValue = attributes[hashAttribute];
  if (!hashValue && fallback && attributes[fallback]) {
    hashAttribute = fallback;
    hashValue = attributes[fallback];
  }
  return { hashAttribute, hashValue: hashValue ? toString(hashValue) : "" };
}

// The measurement arm turns "interleaving vs status quo" into a standard
// user-level experiment: both arms emit a regular Experiment Viewed exposure
// under `<key>__measurement`, so any pipeline that analyzes experiments can
// analyze the holdout comparison with no new machinery.
function emitMeasurementExposure(
  gb: GrowthBook,
  key: string,
  arm: InterleaveArm,
  hashAttribute: string,
  hashValue: string,
): void {
  let tracked = measurementTracked.get(gb);
  if (!tracked) {
    tracked = new Set();
    measurementTracked.set(gb, tracked);
  }
  const dedupeKey = key + ":" + hashValue + ":" + arm;
  if (tracked.has(dedupeKey)) return;
  tracked.add(dedupeKey);
  if ("logEvent" in gb && typeof gb.logEvent === "function") {
    gb.logEvent(EVENT_EXPERIMENT_VIEWED, {
      experimentId: key + MEASUREMENT_EXPERIMENT_SUFFIX,
      variationId: arm === "measurement" ? "status-quo" : "interleaved",
      hashAttribute,
      hashValue,
    });
  }
}

function getMeasurementArm(
  config: InterleaveRuleConfig,
  key: string,
  hashValue: string,
): InterleaveArm {
  const pct = config.measurementArmPercent;
  // Valid range is (0, 100); anything else disables the measurement split
  if (typeof pct !== "number" || !(pct > 0) || pct >= 100) {
    return "interleaved";
  }
  const n = hash(
    (config.seed || key) + MEASUREMENT_EXPERIMENT_SUFFIX,
    hashValue,
    config.hashVersion || 2,
  );
  if (n === null) return "interleaved";
  return n < pct / 100 ? "measurement" : "interleaved";
}

// Run an interleaving experiment against a GrowthBook instance. Diversion is
// controlled by the feature with the same key: a matched `interleave` rule
// (source "interleave") runs the team draft over the caller's registered
// lists; any other outcome yields a plain value naming the list to serve.
// The caller supplies only the experiment/feature key, its candidate lists
// (typically precomputed by an upstream ranking system), and the item
// identity function.
export function interleave<T>(
  gb: GrowthBook,
  options: InterleaveOptions<T>,
): InterleaveResult<T> {
  const { key, lists, getItemId } = options;
  const interleaveId =
    options.interleaveId ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2));

  const untrackedResult = (list?: InterleaveList<T>): InterleaveResult<T> => {
    const fallbackName = options.fallback || (lists[0] && lists[0].name);
    const resolved =
      list || lists.find((l) => l.name === fallbackName) || lists[0];
    return {
      inExperiment: false,
      interleaveId,
      key,
      items: resolved ? realizeList(resolved) : [],
      trackingProps: (itemId: string) => ({ item_id: itemId }),
    };
  };

  // 1. Evaluate the controller feature. Feature evaluation stays pure: it
  // only decides whether this user diverts; the draft happens here.
  const res = gb.evalFeature(key);
  if (res.source !== "interleave" || !res.interleaveConfig) {
    // Routed to a plain value: serve the list it names when registered,
    // otherwise the caller's fallback (also covers a missing feature)
    const routed =
      typeof res.value === "string"
        ? lists.find((l) => l.name === res.value)
        : undefined;
    return untrackedResult(routed);
  }
  const config = res.interleaveConfig;

  // 2. The rule selects which caller lists get woven
  const selected = (config.lists || []).map((name) =>
    lists.find((l) => l.name === name),
  );
  if (selected.length < 2 || selected.some((l) => !l)) {
    return untrackedResult();
  }

  // 3. User identity (measurement split + draft determinism)
  const attributes = gb.getAttributes();
  const { hashAttribute, hashValue } = getHashValue(
    attributes,
    config.hashAttribute,
    config.fallbackAttribute,
  );
  if (!hashValue) return untrackedResult();

  // 3.5. Measurement split: a user-level holdout served the control list
  // unchanged, so interleaving itself can be compared against the status quo
  // as a standard user-level experiment
  const arm = getMeasurementArm(config, key, hashValue);
  if (
    typeof config.measurementArmPercent === "number" &&
    config.measurementArmPercent > 0 &&
    config.measurementArmPercent < 100
  ) {
    emitMeasurementExposure(gb, key, arm, hashAttribute, hashValue);
  }
  if (arm === "measurement") {
    return { ...untrackedResult(), arm };
  }

  // 4. Realize only the selected lists and run the per-impression draft
  const realized = (selected as InterleaveList<T>[]).map((l) => ({
    name: l.name,
    items: realizeList(l),
  }));
  const rng = (round: number, captain: number) =>
    hash(
      (config.seed || key) + "__interleave",
      interleaveId + ":" + round + ":" + captain,
      2,
    ) ?? 0.5;
  const { items, meta } = itemDraft(realized, getItemId, rng, config.maxItems);

  // 5. Emit the exposure: plugin callback first, then the instance's generic
  // event path (one event per impression, no dedupe)
  const data: InterleaveExposureData = {
    timestamp: Date.now(),
    experimentId: key,
    interleaveId,
    hashAttribute,
    hashValue,
    items: meta,
  };
  const settings = pluginSettings.get(gb) || {};
  if (settings.onExposure) {
    try {
      settings.onExposure(data);
    } catch (e) {
      // Exposure logging must never break serving
    }
  }
  if ("logEvent" in gb && typeof gb.logEvent === "function") {
    gb.logEvent(EVENT_INTERLEAVE_EXPOSURE, { ...data });
  }

  return {
    inExperiment: true,
    interleaveId,
    key,
    arm,
    items,
    trackingProps: (itemId: string) => ({
      item_id: itemId,
      interleave_id: interleaveId,
      experiment_id: key,
    }),
  };
}
