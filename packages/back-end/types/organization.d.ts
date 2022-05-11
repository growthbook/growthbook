import { ImplementationType } from "./experiment";

export type Permissions = {
  // Colloborator
  addComments?: boolean;
  refreshResults?: boolean;
  editMetadata?: boolean;

  // Analysts
  createExperiments?: boolean;
  createMetrics?: boolean;
  createDimensions?: boolean;
  createSegments?: boolean;

  // Developers
  // All of the above, plus:
  publishFeatures?: boolean;
  createFeatures?: boolean;

  // Admin only
  // All of the above, plus:
  publishProtectedEnvs?: boolean;
  organizationSettings?: boolean;
  createDatasources?: boolean;
};

export type MemberRole =
  | "readonly"
  | "collaborator"
  | "designer"
  | "analyst"
  | "developer"
  | "admin";

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

export interface Namespaces {
  name: string;
  description: string;
}

export type SDKAttributeType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "enum";

export type SDKAttributeSchema = {
  property: string;
  datatype: SDKAttributeType;
  hashAttribute?: boolean;
  enum?: string;
}[];

export type ExperimentUpdateSchedule = {
  type: "cron" | "never" | "stale";
  cron?: string;
  hours?: number;
};

export type Environment = {
  id: string;
  description?: string;
  toggleOnList?: boolean;
};

export interface OrganizationSettings {
  visualEditorEnabled?: boolean;
  confidenceLevel?: number;
  customized?: boolean;
  logoPath?: string;
  primaryColor?: string;
  secondaryColor?: string;
  northStar?: NorthStarMetric;
  namespaces?: Namespaces[];
  datasources?: string[];
  techsources?: string[];
  pastExperimentsMinLength?: number;
  metricAnalysisDays?: number;
  updateSchedule?: ExperimentUpdateSchedule;
  attributeSchema?: SDKAttributeSchema;
  environments?: Environment[];
  sdkInstructionsViewed?: boolean;
  multipleExposureMinPercent?: number;
  /** @deprecated */
  implementationTypes?: ImplementationType[];
}

export interface OrganizationInterface {
  id: string;
  url: string;
  claimedDomain?: string;
  name: string;
  ownerEmail: string;
  stripeCustomerId?: string;
  restrictLoginMethod?: string;
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

export type NamespaceUsage = Record<
  string,
  {
    featureId: string;
    trackingKey: string;
    environment: string;
    start: number;
    end: number;
  }[]
>;
