import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import React from "react";
import { Box } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import AssignmentTester from "@/components/Archetype/AssignmentTester";
import { useUser } from "@/services/UserContext";
import PremiumEmptyState from "@/components/PremiumEmptyState";

export default function FeatureTest({
  baseFeature,
  feature,
  revision,
  revisions,
  version,
  setVersion,
}: {
  baseFeature: FeatureInterface;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface | null;
  revisions: MinimalFeatureRevisionInterface[];
  version: number | null;
  setVersion: (v: number) => void;
}) {
  const { hasCommercialFeature } = useUser();

  const hasSimulateFeature = hasCommercialFeature("simulate");
  const hasArchetypeFeature = hasCommercialFeature("archetypes");

  if (!baseFeature || !feature || !revision) {
    return <LoadingOverlay />;
  }
  const currentVersion = version || baseFeature.version;

  if (!hasSimulateFeature && !hasArchetypeFeature) {
    return (
      <Box className="contents container-fluid pagecontents">
        <PremiumEmptyState
          commercialFeature={"simulate"}
          title={"Feature Testing"}
          description={
            "Feature allows you to see how your rules will apply to users based on their attributes. Upgrade to unlock this feature."
          }
          learnMoreLink="https://docs.growthbook.io/features/rules#testing-rules"
        />
      </Box>
    );
  }
  return (
    <>
      <Box className="contents container-fluid pagecontents">
        <AssignmentTester
          feature={feature}
          version={currentVersion}
          project={feature.project}
          setVersion={setVersion}
          revisions={revisions}
          baseFeature={baseFeature}
        />
      </Box>
    </>
  );
}
