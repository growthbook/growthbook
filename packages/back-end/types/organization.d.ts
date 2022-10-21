import Stripe from "stripe";
import { ALL_PERMISSIONS } from "../src/util/organization.util";
import { ImplementationType } from "./experiment";

export type EnvScopedPermission = Extract<
  typeof ALL_PERMISSIONS[number],
  "publishFeatures"
>;
export type GlobalPermission = Exclude<
  typeof ALL_PERMISSIONS[number],
  EnvScopedPermission
>;

export type Permission =
  | GlobalPermission
  | EnvScopedPermission
  | `${EnvScopedPermission}.${string}`;

export type MemberRole = string;

export type Role = {
  id: string;
  description: string;
  permissions: Permission[];
  default?: boolean;
};

export type AccountPlan = "starter" | "pro" | "pro_sso" | "enterprise";
export type AccountPlanFeature = "customRoles" | "sso";
export type AccountPlanFeatures = Record<AccountPlan, Set<AccountPlanFeature>>;

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
  members: Member[];
  invites: Invite[];
  useCustomRoles?: boolean;
  roles: Role[];

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
  // Max number of seats
  qty: number;
  // Date issued
  iat: string;
  // Expiration date
  eat: string;
  // If it's a trial or not
  trial?: boolean;
};
