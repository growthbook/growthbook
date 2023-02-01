import Stripe from "stripe";
import {
  ENV_SCOPED_PERMISSIONS,
  GLOBAL_PERMISSIONS,
  PROJECT_SCOPED_PERMISSIONS,
} from "../src/util/organization.util";
import { ImplementationType } from "./experiment";

export type EnvScopedPermission = typeof ENV_SCOPED_PERMISSIONS[number];
export type ProjectScopedPermission = typeof PROJECT_SCOPED_PERMISSIONS[number];
export type GlobalPermission = typeof GLOBAL_PERMISSIONS[number];

export type Permission =
  | GlobalPermission
  | EnvScopedPermission
  | ProjectScopedPermission;

export type MemberRole =
  | "readonly"
  | "collaborator"
  | "designer"
  | "analyst"
  | "developer"
  | "engineer"
  | "experimenter"
  | "admin";

export type Role = {
  id: MemberRole;
  description: string;
  permissions: Permission[];
};

export type AccountPlan = "oss" | "starter" | "pro" | "pro_sso" | "enterprise";
export type CommercialFeature =
  | "sso"
  | "advanced-permissions"
  | "encrypt-features-endpoint"
  | "override-metrics"
  | "schedule-feature-flag";
export type CommercialFeaturesMap = Record<AccountPlan, Set<CommercialFeature>>;

export interface MemberRoleInfo {
  role: MemberRole;
  limitAccessByEnvironment: boolean;
  environments: string[];
}

export interface ProjectMemberRole extends MemberRoleInfo {
  project: string;
}

export interface MemberRoleWithProjects extends MemberRoleInfo {
  projectRoles?: ProjectMemberRole[];
}

export interface Invite extends MemberRoleWithProjects {
  email: string;
  key: string;
  dateCreated: Date;
}

export interface Member extends MemberRoleWithProjects {
  id: string;
  dateCreated?: Date;
}

export interface ExpandedMember extends Member {
  email: string;
  name: string;
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

export interface MetricDefaults {
  minimumSampleSize?: number;
  maxPercentageChange?: number;
  minPercentageChange?: number;
}

export interface Namespaces {
  name: string;
  description: string;
  status: "active" | "inactive";
}

export type SDKAttributeType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "enum";

export type SDKAttribute = {
  property: string;
  datatype: SDKAttributeType;
  hashAttribute?: boolean;
  enum?: string;
  archived?: boolean;
};
export type SDKAttributeSchema = SDKAttribute[];

export type ExperimentUpdateSchedule = {
  type: "cron" | "never" | "stale";
  cron?: string;
  hours?: number;
};

export type Environment = {
  id: string;
  description?: string;
  toggleOnList?: boolean;
  defaultState?: boolean;
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
  metricDefaults?: MetricDefaults;
  datasources?: string[];
  techsources?: string[];
  pastExperimentsMinLength?: number;
  metricAnalysisDays?: number;
  updateSchedule?: ExperimentUpdateSchedule;
  attributeSchema?: SDKAttributeSchema;
  environments?: Environment[];
  sdkInstructionsViewed?: boolean;
  videoInstructionsViewed?: boolean;
  multipleExposureMinPercent?: number;
  defaultRole?: MemberRoleInfo;
  statsEngine?: "bayesian" | "frequentist";
  pValueThreshold?: number;
  /** @deprecated */
  implementationTypes?: ImplementationType[];
}

export interface SubscriptionQuote {
  currentSeatsPaidFor: number;
  activeAndInvitedUsers: number;
  unitPrice: number;
  discountAmount: number;
  discountMessage: string;
  subtotal: number;
  total: number;
  additionalSeatPrice: number;
}

export interface OrganizationConnections {
  slack?: SlackConnection;
  vercel?: VercelConnection;
}

export interface SlackConnection {
  team: string;
  token: string;
}

export interface VercelConnection {
  token: string;
  configurationId: string;
  teamId: string | null;
}

export interface OrganizationInterface {
  id: string;
  url: string;
  dateCreated: Date;
  name: string;
  ownerEmail: string;
  stripeCustomerId?: string;
  restrictLoginMethod?: string;
  restrictAuthSubPrefix?: string;
  freeSeats?: number;
  discountCode?: string;
  priceId?: string;
  disableSelfServeBilling?: boolean;
  enterprise?: boolean;
  subscription?: {
    id: string;
    qty: number;
    trialEnd: Date | null;
    status: Stripe.Subscription.Status;
    current_period_end: number;
    cancel_at: number | null;
    canceled_at: number | null;
    cancel_at_period_end: boolean;
    planNickname: string | null;
    priceId?: string;
  };
  licenseKey?: string;
  members: Member[];
  invites: Invite[];
  connections?: OrganizationConnections;
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

export type LicenseData = {
  // Unique id for the license key
  ref: string;
  // Name of organization on the license
  sub: string;
  // Organization ID (keys prior to 12/2022 do not contain this field)
  org?: string;
  // Max number of seats
  qty: number;
  // Date issued
  iat: string;
  // Expiration date
  exp: string;
  // If it's a trial or not
  trial: boolean;
  // The plan (pro, enterprise, etc.)
  plan: AccountPlan;
  /**
   * Expiration date (old style)
   * @deprecated
   */
  eat?: string;
};
