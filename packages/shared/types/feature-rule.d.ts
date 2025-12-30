import { CreateSafeRolloutInterface, FeatureRule } from "shared/validators";

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
