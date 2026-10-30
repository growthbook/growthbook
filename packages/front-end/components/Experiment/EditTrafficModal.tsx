import { useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getEqualWeights, getLatestPhaseVariations } from "shared/experiments";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { distributeWeights } from "@/services/utils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

export default function EditTrafficModal({
  experiment,
  coverage: savedCoverage,
  weights: savedWeights,
  close,
  stage,
}: {
  experiment: ExperimentInterfaceStringDates;
  coverage: number;
  weights: number[];
  close: () => void;
  stage: (traffic: { coverage: number; variationWeights: number[] }) => void;
}) {
  const isBandit = experiment.type === "multi-armed-bandit";
  const variations = getLatestPhaseVariations(experiment);
  const [coverage, setCoverage] = useState(savedCoverage);
  // Legacy phases can store fewer weights than there are variations; a split
  // that doesn't fit starts even, so every variation can be edited.
  const [weights, setWeights] = useState(() =>
    savedWeights.length === variations.length
      ? savedWeights
      : getEqualWeights(variations.length),
  );

  return (
    <ModalStandard
      trackingEventModalType="edit-traffic-modal"
      open={true}
      close={close}
      header="Edit Traffic"
      cta="Apply"
      submit={() =>
        stage({
          coverage,
          variationWeights: isBandit
            ? savedWeights
            : distributeWeights(weights, true),
        })
      }
      size="lg"
    >
      <div className="pt-2">
        <FeatureVariationsInput
          label={null}
          coverageLabel="Rollout percentage"
          coverageTooltip={`The share of targeted users in this ${isBandit ? "Bandit" : "experiment"}. The rest aren't assigned a variation.`}
          valueAsId
          hideSplits={isBandit}
          startEditingSplits
          coverage={coverage}
          setCoverage={setCoverage}
          setWeight={(i, weight) =>
            setWeights((prev) => prev.map((w, j) => (j === i ? weight : w)))
          }
          variations={variations.map((v, i) => ({
            value: v.key || "",
            name: v.name,
            weight: weights[i],
            id: v.id,
          }))}
          showPreview
        />
      </div>
    </ModalStandard>
  );
}
