import { GrowthBookPayload } from "@growthbook/growthbook";

export interface GeneratedHypothesisInterface {
  id: string;
  uuid: string;
  createdAt: Date;
  organization: string;
  url: string;
  hypothesis: string;
  payload: GrowthBookPayload;
  experiment?: string;
}
