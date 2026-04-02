import { FeatureRule as FeatureDefinitionRule } from "@growthbook/growthbook";

export interface FeatureDefinition {
  // eslint-disable-next-line
  defaultValue: any;
  rules?: FeatureDefinitionRule[];
}
