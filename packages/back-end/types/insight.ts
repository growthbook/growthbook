import { Vote } from "./vote";

export interface LearningInterface {
  id: string;
  text: string;
  details?: string;
  userId: string;
  organization: string;
  tags: string[];
  evidence: {
    experimentId: string;
  }[];
  votes?: Vote[];
  status: "accepted" | "more evidence needed" | "rejected";
  dateCreated: Date;
  dateUpdated: Date;
}

export interface Comments {
  id: string;
  contentId: string;
  type: "learning" | "experiment" | "variation";
  dateCreated: Date;
  dateUpdated: Date;
}
