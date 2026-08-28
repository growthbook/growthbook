import type { GrowthBook } from "../GrowthBook";
import type {
  GrowthBookClient,
  UserScopedGrowthBook,
} from "../GrowthBookClient";
import type {
  InterleaveExperiment,
  InterleaveExposureCallback,
  InterleaveExposureData,
  InterleaveList,
  InterleaveOptions,
  InterleaveResult,
} from "../types/growthbook";
import { itemDraft } from "../interleave";
import { hash, inRange, toString } from "../util";
import { evalCondition } from "../mongrule";
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
  definition: InterleaveExperiment,
  key: string,
  hashValue: string,
): InterleaveArm {
  const pct = definition.measurementArmPercent;
  // Valid range is (0, 100); anything else disables the measurement split
  if (typeof pct !== "number" || !(pct > 0) || pct >= 100) {
    return "interleaved";
  }
  const n = hash(
    (definition.seed || key) + MEASUREMENT_EXPERIMENT_SUFFIX,
    hashValue,
    definition.hashVersion || 2,
  );
  if (n === null) return "interleaved";
  return n < pct / 100 ? "measurement" : "interleaved";
}

function isFilteredOut(
  definition: InterleaveExperiment,
  attributes: Record<string, unknown>,
): boolean {
  return (definition.filters || []).some((filter) => {
    const { hashValue } = getHashValue(attributes, filter.attribute);
    if (!hashValue) return true;
    const n = hash(filter.seed, hashValue, filter.hashVersion || 2);
    if (n === null) return true;
    return !filter.ranges.some((r) => inRange(n, r));
  });
}

// Run an interleaving experiment against a GrowthBook instance. The
// definition (which lists to weave, coverage, targeting, kill switch) comes
// from the instance's payload; the caller supplies only the experiment key,
// its candidate lists (typically precomputed by an upstream/offline ranking
// system — the SDK just picks and weaves), and the item identity function.
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

  const fallbackResult = (): InterleaveResult<T> => {
    const name = options.fallback || (lists[0] && lists[0].name);
    const list = lists.find((l) => l.name === name) || lists[0];
    return {
      inExperiment: false,
      interleaveId,
      key,
      items: list ? realizeList(list) : [],
      trackingProps: (itemId: string) => ({ item_id: itemId }),
    };
  };

  // 1. Look up the payload-delivered definition
  const definition = (gb.getInterleaveExperiments() || []).find(
    (d) => d.key === key,
  );
  if (!definition || definition.active === false) return fallbackResult();

  // 2. The definition selects which caller lists get woven
  const selected = (definition.lists || []).map((name) =>
    lists.find((l) => l.name === name),
  );
  if (selected.length < 2 || selected.some((l) => !l)) return fallbackResult();

  // 3. Per-user enrollment: hash attribute, filters, condition, coverage
  const attributes = gb.getAttributes();
  const { hashAttribute, hashValue } = getHashValue(
    attributes,
    definition.hashAttribute,
    definition.fallbackAttribute,
  );
  if (!hashValue) return fallbackResult();
  if (isFilteredOut(definition, attributes)) return fallbackResult();
  if (
    definition.condition &&
    !evalCondition(attributes, definition.condition, gb.getSavedGroups())
  ) {
    return fallbackResult();
  }
  const enrollHash = hash(
    definition.seed || key,
    hashValue,
    definition.hashVersion || 2,
  );
  if (enrollHash === null) return fallbackResult();
  if (enrollHash > (definition.coverage ?? 1)) return fallbackResult();

  // 3.5. Measurement split: a user-level holdout served the control list
  // unchanged, so interleaving itself can be compared against the status quo
  // as a standard user-level experiment
  const arm = getMeasurementArm(definition, key, hashValue);
  if (
    typeof definition.measurementArmPercent === "number" &&
    definition.measurementArmPercent > 0 &&
    definition.measurementArmPercent < 100
  ) {
    emitMeasurementExposure(gb, key, arm, hashAttribute, hashValue);
  }
  if (arm === "measurement") {
    return { ...fallbackResult(), arm };
  }

  // 4. Realize only the selected lists and run the per-impression draft
  const realized = (selected as InterleaveList<T>[]).map((l) => ({
    name: l.name,
    items: realizeList(l),
  }));
  const rng = (round: number, captain: number) =>
    hash(
      (definition.seed || key) + "__interleave",
      interleaveId + ":" + round + ":" + captain,
      2,
    ) ?? 0.5;
  const { items, meta } = itemDraft(
    realized,
    getItemId,
    rng,
    definition.maxItems,
  );

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
