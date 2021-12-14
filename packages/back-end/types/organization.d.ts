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

export interface NorthStarMetric {
  //enabled: boolean;
  title: string;
  metricIds: string[];
  target?: number | number[];
  window?: string;
  resolution?: string;
  startDate?: Date;
}

export type SDKAttributeType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]";

export type SDKAttributeSchema = {
  property: string;
  datatype: SDKAttributeType;
}[];

export type ExperimentUpdateSchedule = {
  type: "cron" | "never" | "stale";
  cron?: string;
  hours?: number;
};

export interface OrganizationSettings {
  visualEditorEnabled?: boolean;
  confidenceLevel?: number;
  customized?: boolean;
  logoPath?: string;
  primaryColor?: string;
  secondaryColor?: string;
  northStar?: NorthStarMetric;
  datasources?: string[];
  techsources?: string[];
  pastExperimentsMinLength?: number;
  metricAnalysisDays?: number;
  updateSchedule?: ExperimentUpdateSchedule;
  attributeSchema?: SDKAttributeSchema;
  multipleExposureMinPercent?: number;
  /** @deprecated */
  implementationTypes?: ImplementationType[];
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
    trialEnd: Date | null;
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
