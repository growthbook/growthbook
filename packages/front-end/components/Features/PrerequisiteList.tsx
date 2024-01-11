import { FeatureInterface } from "back-end/types/feature";
import { getPrerequisites } from "@/services/features";
import Prerequisite from "@/components/Features/Prerequisite";

export default function PrerequisiteList({
  feature,
  features,
  mutate,
  setPrerequisiteModal,
  version,
  setVersion,
  locked,
}: {
  feature: FeatureInterface;
  features: FeatureInterface[];
  mutate: () => void;
  setPrerequisiteModal: (prerequisite: { i: number }) => void;
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
}) {
  const items = getPrerequisites(feature);

  if (!items.length) {
    return (
      <div className="px-3 mb-3">
        <em>None</em>
      </div>
    );
  }

  return (
    <>
      {items.map(({ ...item }, i) => {
        const parentFeature = features.find((f) => f.id === item.parentId);
        return (
          <Prerequisite
            key={i}
            i={i}
            feature={feature}
            parentFeature={parentFeature}
            prerequisite={item}
            mutate={mutate}
            setPrerequisiteModal={setPrerequisiteModal}
            version={version}
            setVersion={setVersion}
            locked={locked}
          />
        );
      })}
    </>
  );
}
