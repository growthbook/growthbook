import { FeatureInterface } from "back-end/types/feature";
import { getPrerequisites } from "@/services/features";
import Prerequisite from "@/components/Features/Prerequisite";

export default function PrerequisiteList({
  feature,
  features,
  mutate,
  setPrerequisiteModal,
}: {
  feature: FeatureInterface;
  features: FeatureInterface[];
  mutate: () => void;
  setPrerequisiteModal: (prerequisite: { i: number }) => void;
}) {
  const items = getPrerequisites(feature);

  if (!items.length) {
    return (
      <div className="mx-2 mt-2 mb-3">
        <em>None</em>
      </div>
    );
  }

  return (
    <>
      {items.map(({ ...item }, i) => {
        const parentFeature = features.find((f) => f.id === item.id);
        return (
          <Prerequisite
            key={i}
            i={i}
            feature={feature}
            features={features}
            parentFeature={parentFeature}
            prerequisite={item}
            mutate={mutate}
            setPrerequisiteModal={setPrerequisiteModal}
          />
        );
      })}
    </>
  );
}
