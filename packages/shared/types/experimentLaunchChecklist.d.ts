export interface ChecklistTask {
  task: string;
  completionType: "manual" | "auto";
  url?: string;
  customFieldId?: string;
  propertyKey?:
    | "description"
    | "hypothesis"
    | "project"
    | "tag"
    | "screenshots"
    | "prerequisiteTargeting"
    | "customField";
}

export interface ExperimentLaunchChecklistInterface {
  id: string;
  organizationId: string;
  dateCreated: Date;
  dateUpdated: Date;
  updatedByUserId: string;
  tasks: ChecklistTask[];
  projectId: string;
}
