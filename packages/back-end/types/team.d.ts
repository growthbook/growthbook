import { ManagedBy } from "back-end/src/validators/managed-by";
import { ProjectMemberRole } from "./organization";

export interface TeamInterface {
  id: string;
  name: string;
  organization: string;
  dateCreated: Date;
  dateUpdated: Date;
  createdBy: string;
  description: string;
  role: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
  projectRoles?: ProjectMemberRole[];
  members?: string[];
  managedByIdp: boolean;
  managedBy?: ManagedBy;
}
