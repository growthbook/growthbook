import { ProjectMemberRole } from "./organization";
import { ManagedBy } from "back-end/src/validators/managed-by";

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
