import { Vote } from "shared/types/vote";

// Where the idea was submitted from
export type IdeaSource = "web" | "slack";

export interface IdeaInterface {
  id: string;
  text: string;
  archived: boolean;
  details?: string;
  userId: string | null;
  userName?: string;
  source?: IdeaSource;
  organization: string;
  project?: string;
  tags: string[];
  votes?: Vote[];
  dateCreated: Date;
  dateUpdated: Date;
  impactScore: number;
  experimentLength: number;
  estimateParams?: {
    segment: string;
    estimate: string;
    improvement: number;
    numVariations: number;
    userAdjustment: number;
  };
}
