import track from "@/services/track";
import LinkedFeatureFlag from "../LinkedFeatureFlag";
import LinkedChangesContainer from "./LinkedChangesContainer";

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
