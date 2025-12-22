export type DiscussionParentType = "experiment" | "idea" | "metric" | "feature";

export interface Comment {
  date: Date;
  userId: string;
  userEmail: string;
  userName: string;
  content: string;
  edited?: boolean;
}
export interface DiscussionInterface {
  id: string;
  organization: string;
  parentType: DiscussionParentType;
  parentId: string;
  comments: Comment[];
  dateUpdated: Date;
}
