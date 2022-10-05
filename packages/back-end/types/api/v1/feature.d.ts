import { FeatureDefinition } from "../../api";
import { FeatureInterface, FeatureEnvironment } from "../../feature";

export type ApiV1Feature = Omit<
  FeatureInterface,
  "organization" | "draft" | "revision" | "environmentSettings"
> & {
  environments: Record<string, FeatureEnvironment>;
  draftEnvironments: Record<string, FeatureEnvironment>;
  definition: FeatureDefinition;
};
