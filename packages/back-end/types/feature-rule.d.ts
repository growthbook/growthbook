import { FeatureRule } from "back-end/src/validators/features";
import { CreateSafeRolloutInterface } from "back-end/src/validators/safe-rollout";

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environment: string;
  interfaceFields?: CreateSafeRolloutInterface;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  interfaceFields?: Partial<CreateSafeRolloutInterface>;
  environment: string;
  i: number;
};
