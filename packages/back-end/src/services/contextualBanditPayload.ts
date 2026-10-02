import type { AutoExperiment } from "@growthbook/growthbook";
import {
  AutoExperimentWithMetadata,
  ContextualBanditDefinitions,
  FeatureDefinition,
} from "shared/types/sdk";
import type { ContextualBanditInterface } from "shared/validators";
import type { VisualChangesetInterface } from "shared/types/visual-changeset";
import { getActiveVariations } from "shared/experiments";
import { pairedWeightsToPositional } from "back-end/src/util/features";
import { logger } from "back-end/src/util/logger";
import { Histogram, metrics } from "back-end/src/util/metrics";

export const CB_PAYLOAD_WARN_BYTES = 512 * 1024;
export const CB_PAYLOAD_WARN_FRACTION = 0.5;

export type ContextualBanditPayloadStats = {
  /** Distinct CBs in the payload's `contextualBandits` map */
  cbCount: number;
  /** Rules pointing at the map — cbRuleCount/cbCount > 1 means shared CBs (dedup working) */
  cbRuleCount: number;
  /** Sum of serialized map entry sizes (map braces/commas excluded) */
  cbBytes: number;
  maxSingleCbBytes: number;
  maxLeaves: number;
};

export function measureContextualBanditPayload(
  contextualBandits: ContextualBanditDefinitions,
  features: Record<string, FeatureDefinition>,
): ContextualBanditPayloadStats {
  let cbBytes = 0;
  let maxSingleCbBytes = 0;
  let maxLeaves = 0;
  const entries = Object.entries(contextualBandits);
  entries.forEach(([id, entry]) => {
    const entryBytes = Buffer.byteLength(JSON.stringify({ [id]: entry }));
    cbBytes += entryBytes;
    if (entryBytes > maxSingleCbBytes) maxSingleCbBytes = entryBytes;
    if (entry.contexts.length > maxLeaves) maxLeaves = entry.contexts.length;
  });

  let cbRuleCount = 0;
  Object.values(features).forEach((feature) => {
    feature.rules?.forEach((rule) => {
      if (rule.contextualBanditRef) cbRuleCount++;
    });
  });

  return {
    cbCount: entries.length,
    cbRuleCount,
    cbBytes,
    maxSingleCbBytes,
    maxLeaves,
  };
}

let cbPayloadBytesHistogram: Histogram | null = null;
let cbPayloadFractionHistogram: Histogram | null = null;

function getCbPayloadBytesHistogram() {
  if (!cbPayloadBytesHistogram) {
    cbPayloadBytesHistogram = metrics.getHistogram("sdk_payload.cb_bytes");
  }
  return cbPayloadBytesHistogram;
}

function getCbPayloadFractionHistogram() {
  if (!cbPayloadFractionHistogram) {
    cbPayloadFractionHistogram = metrics.getHistogram(
      "sdk_payload.cb_fraction",
    );
  }
  return cbPayloadFractionHistogram;
}

export function recordContextualBanditPayloadMetrics(
  stats: ContextualBanditPayloadStats,
  totalBytes: number,
) {
  try {
    getCbPayloadBytesHistogram().record(stats.cbBytes);
    if (totalBytes > 0) {
      getCbPayloadFractionHistogram().record(stats.cbBytes / totalBytes);
    }
  } catch (e) {
    logger.error({ err: e }, "Error recording sdk_payload CB size metrics");
  }
}

export type CbVisualExperiment = {
  type: "cb-visual";
  contextualBandit: ContextualBanditInterface;
  visualChangeset: VisualChangesetInterface;
};

export function filterCbVisualExperimentsByProject(
  cbVisualExperiments: CbVisualExperiment[],
  projectList: string[],
): CbVisualExperiment[] {
  if (!projectList.length) return cbVisualExperiments;
  return cbVisualExperiments.filter((e) =>
    projectList.includes(e.contextualBandit.project || ""),
  );
}

export function buildCbVisualAutoExperiment({
  cbVisualExperiment,
  changeId,
  condition,
  includeExperimentNames,
}: {
  cbVisualExperiment: CbVisualExperiment;
  changeId: string;
  condition: AutoExperimentWithMetadata["condition"];
  includeExperimentNames?: boolean;
}): AutoExperimentWithMetadata | null {
  const { contextualBandit: cb, visualChangeset } = cbVisualExperiment;
  const cbVariations = getActiveVariations(cb.variations);
  if (cbVariations.length === 0) return null;

  const variations = cbVariations.map((v) => {
    const match = visualChangeset.visualChanges.find(
      (vc) => vc.variation === v.id,
    );
    return {
      css: match?.css || "",
      js: match?.js || "",
      domMutations: match?.domMutations || [],
    };
  }) as AutoExperiment["variations"];

  const weights = cb.variationWeights
    ? pairedWeightsToPositional(cb.variationWeights, cbVariations)
    : undefined;

  return {
    key: cb.trackingKey,
    changeId,
    status: cb.status,
    variations,
    hashVersion: 2,
    hashAttribute: cb.hashAttribute,
    disableStickyBucketing: true,
    urlPatterns: visualChangeset.urlPatterns,
    weights,
    meta: cbVariations.map((v) =>
      includeExperimentNames === true
        ? { key: v.key, name: v.name }
        : { key: v.key },
    ),
    seed: cb.seed,
    ...(includeExperimentNames === true ? { name: cb.name } : {}),
    phase: "0",
    condition,
    coverage: cb.coverage,
    contextualBanditRef: cb.id,
  };
}
