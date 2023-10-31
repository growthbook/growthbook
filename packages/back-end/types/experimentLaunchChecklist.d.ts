export interface ExperimentLaunchChecklistInterface {
  id: string;
  organizationId: string;
  dateCreated: Date;
  dateUpdated: Date;
  updatedByUserId: string;
  checklistItems: string[];
}
