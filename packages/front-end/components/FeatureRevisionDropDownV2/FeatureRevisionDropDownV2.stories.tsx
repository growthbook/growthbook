import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FeatureRevisionDropDownV2 } from "./FeatureRevisionDropDownV2";

export default {
  component: FeatureRevisionDropDownV2,
  title: "Feature Revisions/FeatureRevisionDropDownV2",
};

export const Default = () => {
  const revisions: FeatureRevisionInterface[] = [];

  return (
    <>
      <FeatureRevisionDropDownV2 revisions={revisions} />
    </>
  );
};
