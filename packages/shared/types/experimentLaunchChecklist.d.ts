import { BuiltInChecklistItemKey } from "shared/validators";

export { BuiltInChecklistItemKey } from "shared/validators";

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
    | "customField"
    | "schedule";
  // While incomplete, the start is blocked and can't be bypassed.
  blockStart?: boolean;
}

export interface ExperimentLaunchChecklistInterface {
  id: string;
  organizationId: string;
  dateCreated: Date;
  dateUpdated: Date;
  updatedByUserId: string;
  tasks: ChecklistTask[];
  projectId: string;
  hiddenBuiltInItems?: BuiltInChecklistItemKey[];
}
