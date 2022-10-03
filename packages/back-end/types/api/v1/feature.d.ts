import { FeatureInterface } from "../../feature";

export type ApiV1Feature = Omit<
  FeatureInterface,
  "organization" | "draft" | "revision"
>;
