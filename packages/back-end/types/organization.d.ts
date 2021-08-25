import { ImplementationType } from "./experiment";

export type Permissions = {
  draftExperiments?: boolean;
  runExperiments?: boolean;
  createMetrics?: boolean;
  organizationSettings?: boolean;
};

export type MemberRole = "collaborator" | "designer" | "developer" | "admin";

export interface Invite {
  email: string;
  key: string;
  dateCreated: Date;
  role: MemberRole;
}

export interface Member {
  id: string;
  role: MemberRole;
}

export interface OrganizationSettings {
  implementationTypes?: ImplementationType[];
  confidenceLevel?: number;
  customized?: boolean;
  logoPath?: string;
  primaryColor?: string;
  secondaryColor?: string;
  datasources?: string[];
  techsources?: string[];
  pastExperimentsMinLength?: number;
}

export interface OrganizationInterface {
  id: string;
  url: string;
  name: string;
  ownerEmail: string;
  stripeCustomerId?: string;
  subscription?: {
    id: string;
    qty: number;
    trialEnd: Date;
    status:
      | "incomplete"
      | "incomplete_expired"
      | "trialing"
      | "active"
      | "past_due"
      | "canceled"
      | "unpaid";
  };
  members: Member[];
  invites: Invite[];

  connections?: {
    slack?: {
      team: string;
      token: string;
    };
  };
  settings?: OrganizationSettings;
}
