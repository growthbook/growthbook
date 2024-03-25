import track from "@front-end/services/track";

import LinkedFeatureFlag from "@front-end/components/Experiment/LinkedFeatureFlag";
import LinkedChangesContainer from "@front-end/components/Experiment/LinkedChanges/LinkedChangesContainer";

export default function FeatureLinkedChanges({
  setFeatureModal,
  linkedFeatures,
  experiment,
  canAddChanges,
}) {
  const featureFlagCount = linkedFeatures.length;

  return (
    <LinkedChangesContainer
      canAddChanges={canAddChanges}
      changeCount={featureFlagCount}
      type="feature-flag"
      experimentStatus={experiment.status}
      onAddChange={() => {
        setFeatureModal(true);
        track("Open linked feature modal", {
          source: "linked-changes",
          action: "add",
        });
      }}
    >
      {linkedFeatures.map((info, i) => (
        <LinkedFeatureFlag info={info} experiment={experiment} key={i} />
      ))}
    </LinkedChangesContainer>
  );
}
