export interface ChecklistItem {
  item: string;
  type: "manual" | "auto";
  statusKey?: "description" | "hypothesis" | "project" | "tag" | "screenshots";
}

export interface ExperimentLaunchChecklistInterface {
  id: string;
  organizationId: string;
  dateCreated: Date;
  dateUpdated: Date;
  updatedByUserId: string;
  checklistItems: ChecklistItem[];
}
