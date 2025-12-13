import { CreateSafeRolloutInterface } from "shared/validators";
import { FeatureRule } from "back-end/src/validators/features";

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
