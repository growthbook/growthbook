import Stripe from "stripe";
import {
  ENV_SCOPED_PERMISSIONS,
  GLOBAL_PERMISSIONS,
  PROJECT_SCOPED_PERMISSIONS,
} from "shared/permissions";
import type { ReqContextClass } from "../src/services/context";
import { attributeDataTypes } from "../src/util/organization.util";
import { AttributionModel, ImplementationType } from "./experiment";
import type { PValueCorrection, StatsEngine } from "./stats";
import { MetricCappingSettings, MetricWindowSettings } from "./fact-table";

export type EnvScopedPermission = typeof ENV_SCOPED_PERMISSIONS[number];
export type ProjectScopedPermission = typeof PROJECT_SCOPED_PERMISSIONS[number];
export type GlobalPermission = typeof GLOBAL_PERMISSIONS[number];

export type Permission =
  | GlobalPermission
  | EnvScopedPermission
  | ProjectScopedPermission;

export type PermissionsObject = Partial<Record<Permission, boolean>>;

export type UserPermission = {
  environments: string[];
  limitAccessByEnvironment: boolean;
  permissions: PermissionsObject;
};

export type UserPermissions = {
  global: UserPermission;
  projects: { [key: string]: UserPermission };
};
export type RequireReview = {
  requireReviewOn: boolean;
  resetReviewOnChange: boolean;
  environments: string[];
  projects: string[];
};

export type MemberRole =
  | "noaccess"
  | "readonly"
  | "collaborator"
  | "visualEditor"
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

export interface MemberRoleInfo {
  role: MemberRole;
  limitAccessByEnvironment: boolean;
  environments: string[];
  teams?: string[];
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
  externalId?: string;
  managedByIdp?: boolean;
  lastLoginDate?: Date;
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
  windowSettings?: MetricWindowSettings;
  cappingSettings?: MetricCappingSettings;
}

export interface Namespaces {
  name: string;
  description: string;
  status: "active" | "inactive";
}

export type SDKAttributeFormat = "" | "version";

export type SDKAttributeType = typeof attributeDataTypes[number];

export type SDKAttribute = {
  property: string;
  datatype: SDKAttributeType;
  hashAttribute?: boolean;
  enum?: string;
  archived?: boolean;
  format?: SDKAttributeFormat;
  projects?: string[];
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
  projects?: string[];
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
  runHealthTrafficQuery?: boolean;
  srmThreshold?: number;
  /** @deprecated */
  implementationTypes?: ImplementationType[];
  attributionModel?: AttributionModel;
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
  displayCurrency?: string;
  secureAttributeSalt?: string;
  killswitchConfirmation?: boolean;
  requireReviews?: boolean | RequireReview[];
  defaultDataSource?: string;
  disableMultiMetricQueries?: boolean;
  useStickyBucketing?: boolean;
  useFallbackAttributes?: boolean;
  codeReferencesEnabled?: boolean;
  codeRefsBranchesToFilter?: string[];
  codeRefsPlatformUrl?: string;
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
  externalId?: string;
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

export type ReqContext = ReqContextClass;
