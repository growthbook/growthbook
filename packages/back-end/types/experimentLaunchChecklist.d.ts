export interface ChecklistTask {
  task: string;
  completionType: "manual" | "auto";
  url?: string;
  propertyKey?:
    | "description"
    | "hypothesis"
    | "project"
    | "tag"
    | "screenshots";
}

export interface ExperimentLaunchChecklistInterface {
  id: string;
  organizationId: string;
  dateCreated: Date;
  dateUpdated: Date;
  updatedByUserId: string;
  tasks: ChecklistTask[];
}
