import { CreateSafeRolloutInterface } from "back-end/src/models/SafeRolloutModel";
import { FeatureRule } from "back-end/src/validators/features";

export {
  SafeRolloutSnapshotHealth,
  SafeRolloutSnapshotTrafficDimension,
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";

export {
  SafeRolloutInterface,
} from "back-end/src/models/SafeRolloutModel";

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environment: string;
  interfaceFields?: CreateSafeRolloutInterface;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  interfaceFields?: Omit<
    Partial<CreateSafeRolloutInterface>,
    "organization" | "dateCreated" | "dateUpdated"
  >;
  environment: string;
  i: number;
};
