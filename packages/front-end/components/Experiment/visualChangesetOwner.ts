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
  weight?: number;
  previewIndex?: number;
};

export type VisualChangesetOwnerView = {
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
    // Drafts only: a running experiment would lose buckets retroactively.
    canDeleteVariation: (index) =>
      isDraft && index !== 0 && variations.length > 2,
    deleteVariation,
  };
}

export function contextualBanditVisualChangesetOwner(
  cb: Pick<
    ApiContextualBanditInterface,
    "id" | "trackingKey" | "status" | "archived" | "variations"
  >,
  deleteVariation?: (variationId: string) => Promise<void>,
): VisualChangesetOwnerView {
  const variations = getVisibleVariations(cb.variations);
  const activeIds = getActiveVariations(cb.variations).map((v) => v.id);
  const isDraft = cb.status === "draft";
  // Visual changes are only served for running bandits, so a preview of any other state shows the original page.
  const isRunning = cb.status === "running";
  return {
    trackingKey: cb.trackingKey,
    status: cb.status,
    noun: "Contextual Bandit",
    variations: variations.map((v) => {
      const sdkIndex = activeIds.indexOf(v.id);
      return {
        id: v.id,
        name: v.name,
        previewIndex: isRunning && sdkIndex >= 0 ? sdkIndex : undefined,
      };
    }),
    canEditChanges: canEditContextualBanditVisualChanges(cb),
    canDeleteVariation: (index) =>
      isDraft && index !== 0 && variations.length > 2,
    deleteVariation,
  };
}
