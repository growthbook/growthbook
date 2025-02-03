import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "back-end/types/experiment";
import { FaInfoCircle } from "react-icons/fa";
import track from "@/services/track";

import LinkedFeatureFlag from "@/components/Experiment/LinkedFeatureFlag";
import LinkedChangesContainer from "@/components/Experiment/LinkedChanges/LinkedChangesContainer";

export default function FeatureLinkedChanges({
  setFeatureModal,
  linkedFeatures,
  experiment,
  canAddChanges,
  isPublic,
}: {
  setFeatureModal?: (open: boolean) => void;
  linkedFeatures: LinkedFeatureInfo[];
  experiment: ExperimentInterfaceStringDates;
  canAddChanges: boolean;
  isPublic?: boolean;
}) {
  const featureFlagCount = linkedFeatures.length;
  const hasDraftFeatures = linkedFeatures.some((lf) => lf.state === "draft");

  return (
    <LinkedChangesContainer
      canAddChanges={canAddChanges}
      changeCount={featureFlagCount}
      type="feature-flag"
      experimentStatus={experiment.status}
      onAddChange={() => {
        setFeatureModal?.(true);
        track("Open linked feature modal", {
          source: "linked-changes",
          action: "add",
        });
      }}
    >
      {!isPublic ? (
        <>
          {hasDraftFeatures ? (
            <div className="alert alert-info my-3">
              <FaInfoCircle className="mr-2" />
              Features in <strong>Draft</strong> mode will not allow experiments
              to run. Publish Feature from the Feature Flag detail page to
              unblock.
            </div>
          ) : null}
          {linkedFeatures.map((info, i) => (
            <LinkedFeatureFlag info={info} experiment={experiment} key={i} />
          ))}
        </>
      ) : null}
    </LinkedChangesContainer>
  );
}
