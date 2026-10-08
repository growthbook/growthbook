import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ApiContextualBanditInterface } from "shared/validators";
import {
  canEditContextualBanditVisualChanges,
  getActiveVariations,
  getLatestPhaseVariations,
  getVisibleVariations,
} from "shared/experiments";

export type VisualChangesetOwnerVariation = {
  id: string;
  name: string;
  weight: number;
  previewIndex?: number;
};

export type VisualChangesetOwnerView = {
  id: string;
  trackingKey: string;
  status: string;
  noun: string;
  variations: VisualChangesetOwnerVariation[];
  canEditChanges: boolean;
  canDeleteVariation: (index: number) => boolean;
  deleteVariation?: (variationId: string) => Promise<void>;
};

export function experimentVisualChangesetOwner(
  experiment: Pick<
    ExperimentInterfaceStringDates,
    "id" | "trackingKey" | "status" | "variations" | "phases"
  >,
  deleteVariation?: (variationId: string) => Promise<void>,
): VisualChangesetOwnerView {
  const variations = getLatestPhaseVariations(experiment);
  const latestPhase = experiment.phases?.[experiment.phases.length - 1];
  const isDraft = experiment.status === "draft";
  return {
    id: experiment.id,
    trackingKey: experiment.trackingKey,
    status: experiment.status,
    noun: "experiment",
    variations: variations.map((v, i) => ({
      id: v.id,
      name: v.name,
      weight: latestPhase?.variationWeights?.[i] ?? 0,
      previewIndex: i,
    })),
    canEditChanges: isDraft,
    canDeleteVariation: (index) =>
      isDraft && index !== 0 && variations.length > 2,
    deleteVariation,
  };
}

export function contextualBanditVisualChangesetOwner(
  cb: Pick<
    ApiContextualBanditInterface,
    | "id"
    | "trackingKey"
    | "status"
    | "archived"
    | "variations"
    | "variationWeights"
  >,
  deleteVariation?: (variationId: string) => Promise<void>,
): VisualChangesetOwnerView {
  const variations = getVisibleVariations(cb.variations);
  const activeIds = getActiveVariations(cb.variations).map((v) => v.id);
  const weightFor = (variationId: string) =>
    cb.variationWeights?.find((w) => w.variationId === variationId)?.weight ??
    0;
  const isDraft = cb.status === "draft";
  return {
    id: cb.id,
    trackingKey: cb.trackingKey,
    status: cb.status,
    noun: "contextual bandit",
    variations: variations.map((v) => {
      const sdkIndex = activeIds.indexOf(v.id);
      return {
        id: v.id,
        name: v.name,
        weight: weightFor(v.id),
        previewIndex: sdkIndex >= 0 ? sdkIndex : undefined,
      };
    }),
    canEditChanges: canEditContextualBanditVisualChanges(cb),
    canDeleteVariation: (index) =>
      isDraft && index !== 0 && variations.length > 2,
    deleteVariation,
  };
}
