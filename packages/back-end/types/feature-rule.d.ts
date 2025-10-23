import { FeatureRule } from "back-end/src/validators/features";
import { CreateSafeRolloutInterface } from "back-end/src/validators/safe-rollout";

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environments: string[];
  safeRolloutFields?: CreateSafeRolloutInterface;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  environment: string;
  i: number;
};
