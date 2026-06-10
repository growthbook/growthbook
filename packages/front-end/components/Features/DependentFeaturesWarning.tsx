import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { useFeatureDependents } from "@/hooks/useFeatureDependents";
import FeatureReferencesList from "./FeatureReferencesList";

// Non-blocking heads-up shown in edit/publish flows when other features or
// experiments use this feature as a prerequisite. Renders nothing while
// loading or when there are no dependents.
export default function DependentFeaturesWarning({
  featureId,
}: {
  featureId: string;
}) {
  const { dependents } = useFeatureDependents(featureId);

  const featureCount = dependents?.features.length ?? 0;
  const experimentCount = dependents?.experiments.length ?? 0;
  if (!dependents || featureCount + experimentCount === 0) return null;

  const parts: string[] = [];
  if (featureCount > 0) {
    parts.push(`${featureCount} other feature${featureCount === 1 ? "" : "s"}`);
  }
  if (experimentCount > 0) {
    parts.push(
      `${experimentCount} experiment${experimentCount === 1 ? "" : "s"}`,
    );
  }

  return (
    <>
      <Callout status="warning" mb="3">
        <Text as="p" mb="0">
          This feature is a prerequisite for {parts.join(" and ")}. Changing it
          may affect their behavior.
        </Text>
      </Callout>
      <FeatureReferencesList
        features={dependents.features}
        experiments={dependents.experiments}
      />
    </>
  );
}
