import { useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import { getPrerequisites } from "@/services/features";
import usePermissions from "@/hooks/usePermissions";
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
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState(getPrerequisites(feature));
  const permissions = usePermissions();

  if (!items.length) {
    return (
      <div className="px-3 mb-3">
        <em>None</em>
      </div>
    );
  }

  const canEdit =
    !locked &&
    permissions.check("manageFeatures", feature.project) &&
    permissions.check("createFeatureDrafts", feature.project);

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
