import { MemberRole, ProjectMemberRole } from "./organization";

export interface TeamInterface {
  id: string;
  name: string;
  organization: string;
  dateCreated: Date;
  dateUpdated: Date;
  createdBy: string;
  description: string;
  role: MemberRole;
  limitAccessByEnvironment: boolean;
  environments: string[];
  projectRoles?: ProjectMemberRole[];
  members?: string[];
  managedByIdp: boolean;
}
