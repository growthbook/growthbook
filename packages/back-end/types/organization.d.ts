import Stripe from "stripe";
import {
  ENV_SCOPED_PERMISSIONS,
  GLOBAL_PERMISSIONS,
  PROJECT_SCOPED_PERMISSIONS,
} from "../src/util/organization.util";
import { AttributionModel, ImplementationType } from "./experiment";
import type { PValueCorrection, StatsEngine } from "./stats";

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
  | "schedule-feature-flag"
  | "override-metrics"
  | "regression-adjustment"
  | "sequential-testing"
  | "audit-logging"
  | "visual-editor"
  | "cloud-proxy"
  | "hash-secure-attributes";
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

export interface PendingMember extends MemberRoleWithProjects {
  id: string;
  name: string;
  email: string;
  dateCreated: Date;
}

export interface Member extends MemberRoleWithProjects {
  id: string;
  dateCreated?: Date;
}

export interface ExpandedMember extends Member {
  email: string;
  name: string;
  verified: boolean;
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

export type SDKAttributeFormat = "none" | "version";

export type SDKAttributeType =
  | "string"
  | "number"
  | "boolean"
  | "string[]"
  | "number[]"
  | "enum"
  | "secureString"
  | "secureString[]";

export type SDKAttribute = {
  property: string;
  datatype: SDKAttributeType;
  hashAttribute?: boolean;
  enum?: string;
  archived?: boolean;
  format?: SDKAttributeFormat;
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
  statsEngine?: StatsEngine;
  pValueThreshold?: number;
  pValueCorrection?: PValueCorrection;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentDays?: number;
  /** @deprecated */
  implementationTypes?: ImplementationType[];
  attributionModel?: AttributionModel;
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
  secureAttributeSalt?: string;
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

/**
 * The type for the global organization message component
 */
export type OrganizationMessage = {
  message: string;
  level: "info" | "danger" | "warning";
};

export interface OrganizationInterface {
  id: string;
  url: string;
  dateCreated: Date;
  verifiedDomain?: string;
  name: string;
  ownerEmail: string;
  stripeCustomerId?: string;
  restrictLoginMethod?: string;
  restrictAuthSubPrefix?: string;
  freeSeats?: number;
  discountCode?: string;
  priceId?: string;
  disableSelfServeBilling?: boolean;
  freeTrialDate?: Date;
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
    hasPaymentMethod?: boolean;
  };
  licenseKey?: string;
  autoApproveMembers?: boolean;
  members: Member[];
  invites: Invite[];
  pendingMembers?: PendingMember[];
  connections?: OrganizationConnections;
  settings?: OrganizationSettings;
  messages?: OrganizationMessage[];
}

export type NamespaceUsage = Record<
  string,
  {
    link: string;
    name: string;
    id: string;
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
