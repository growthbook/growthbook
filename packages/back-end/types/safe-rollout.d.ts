import { SafeRolloutInterfaceCreateFields } from "back-end/src/models/SafeRolloutModel";
import { FeatureRule } from "back-end/src/validators/features";

export {
  SafeRolloutSnapshotHealth,
  SafeRolloutSnapshotTrafficDimension,
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";

export type PostFeatureRuleBody = {
  rule: FeatureRule;
  environment: string;
  interfaceFields?: SafeRolloutInterfaceCreateFields;
};

export type PutFeatureRuleBody = {
  rule: Partial<FeatureRule>;
  interfaceFields?: Partial<SafeRolloutInterfaceCreateFields>;
  environment: string;
  i: number;
};
