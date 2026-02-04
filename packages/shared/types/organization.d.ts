import Stripe from "stripe";
import { z } from "zod";
import {
  OWNER_JOB_TITLES,
  USAGE_INTENTS,
  attributeDataTypes,
} from "shared/constants";
import {
  ENV_SCOPED_PERMISSIONS,
  GLOBAL_PERMISSIONS,
  PROJECT_SCOPED_PERMISSIONS,
  Policy,
} from "shared/permissions";
import {
  AccountPlan,
  CommercialFeature,
  LicenseInterface,
  SubscriptionInfo,
} from "shared/enterprise";
import { AIModel, EmbeddingModel } from "shared/ai";
import { AgreementType, environment } from "shared/validators";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { ApiKeyInterface } from "shared/types/apikey";
import { TeamInterface } from "shared/types/team";
import { AttributionModel, ImplementationType } from "./experiment";
import type { PValueCorrection, StatsEngine } from "./stats";
import {
  MetricCappingSettings,
  MetricPriorSettings,
  MetricWindowSettings,
} from "./fact-table";

export type EnvScopedPermission = (typeof ENV_SCOPED_PERMISSIONS)[number];
export type ProjectScopedPermission =
  (typeof PROJECT_SCOPED_PERMISSIONS)[number];
export type GlobalPermission = (typeof GLOBAL_PERMISSIONS)[number];

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

export type OwnerJobTitle = keyof typeof OWNER_JOB_TITLES;

export type UsageIntent = keyof typeof USAGE_INTENTS;

export interface DemographicData {
  ownerJobTitle?: OwnerJobTitle;
  ownerUsageIntents?: UsageIntent[];
}

export interface CreateOrganizationPostBody {
  company: string;
  externalId?: string;
  demographicData?: DemographicData;
}

// If adding new default roles, please prefix the role with "gbDefault_" to reduce the risk of collision with custom roles that organizations may have created
export type DefaultMemberRole =
  | "noaccess"
  | "readonly"
  | "collaborator"
  | "visualEditor"
  | "analyst"
  | "engineer"
  | "experimenter"
  | "gbDefault_projectAdmin"
  | "admin";

export type Role = {
  id: string;
  description: string;
  policies: Policy[];
  displayName?: string;
};

export interface MemberRoleInfo {
  role: string;
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

export interface ExpandedMemberInfo {
  email: string;
  name: string;
  verified: boolean;
  numTeams?: number;
}

export type ExpandedMember = Member & ExpandedMemberInfo;

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
  priorSettings?: MetricPriorSettings;
  targetMDE?: number;
}

export interface Namespaces {
  name: string;
  label: string;
  description: string;
  status: "active" | "inactive";
}

export type SDKAttributeFormat = "" | "version" | "date" | "isoCountryCode";

export type SDKAttributeType = (typeof attributeDataTypes)[number];

export type SDKAttribute = {
  property: string;
  datatype: SDKAttributeType;
  description?: string;
  hashAttribute?: boolean;
  enum?: string;
  archived?: boolean;
  format?: SDKAttributeFormat;
  projects?: string[];
  disableEqualityConditions?: boolean;
};

export type SDKAttributeSchema = SDKAttribute[];

export type ExperimentUpdateSchedule = {
  type: "cron" | "never" | "stale";
  cron?: string;
  hours?: number;
};

export type Environment = z.infer<typeof environment>;

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
  aiEnabled?: boolean;
  defaultAIModel?: AIModel;
  embeddingModel?: EmbeddingModel;
  /** @deprecated */
  openAIDefaultModel?: AIModel;
  implementationTypes?: ImplementationType[];
  attributionModel?: AttributionModel;
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
  displayCurrency?: string;
  secureAttributeSalt?: string;
  killswitchConfirmation?: boolean;
  requireReviews?: boolean | RequireReview[];
  defaultDataSource?: string;
  testQueryDays?: number;
  disableMultiMetricQueries?: boolean;
  disablePrecomputedDimensions?: boolean;
  useStickyBucketing?: boolean;
  useFallbackAttributes?: boolean;
  codeReferencesEnabled?: boolean;
  codeRefsBranchesToFilter?: string[];
  codeRefsPlatformUrl?: string;
  featureKeyExample?: string; // Example Key of feature flag (e.g. "feature-20240201-name")
  featureRegexValidator?: string; // Regex to validate feature flag name (e.g. ^.+-\d{8}-.+$)
  requireProjectForFeatures?: boolean;
  featureListMarkdown?: string;
  featurePageMarkdown?: string;
  experimentListMarkdown?: string;
  experimentPageMarkdown?: string;
  metricListMarkdown?: string;
  metricPageMarkdown?: string;
  preferredEnvironment?: string | null; // null (or undefined) means "remember previous environment"
  maxMetricSliceLevels?: number;
  banditScheduleValue?: number;
  banditScheduleUnit?: "hours" | "days";
  banditBurnInValue?: number;
  banditBurnInUnit?: "hours" | "days";
  requireExperimentTemplates?: boolean;
  experimentMinLengthDays?: number;
  experimentMaxLengthDays?: number;
  decisionFrameworkEnabled?: boolean;
  defaultDecisionCriteriaId?: string;
  disableLegacyMetricCreation?: boolean;
  blockFileUploads?: boolean;
  defaultFeatureRulesInAllEnvs?: boolean;
  savedGroupSizeLimit?: number;
  /** @deprecated Use postStratificationEnabled instead */
  postStratificationDisabled?: boolean;
  postStratificationEnabled?: boolean;
}

export interface OrganizationConnections {
  slack?: SlackConnection;
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

// The type used to get member data to calculate usage counts for licenses
export type OrgMemberInfo = {
  id: string;
  invites: { email: string }[];
  members: {
    id: string;
    role: string;
    projectRoles?: { role: string }[];
    teams?: string[];
  }[];
};

export interface OrganizationInterface {
  id: string;
  url: string;
  dateCreated: Date;
  verifiedDomain?: string;
  externalId?: string;
  name: string;
  ownerEmail: string;
  demographicData?: DemographicData;
  /** @deprecated */
  stripeCustomerId?: string;
  restrictLoginMethod?: string;
  restrictAuthSubPrefix?: string;
  isVercelIntegration?: boolean;
  freeSeats?: number;
  discountCode?: string;
  priceId?: string;
  disableSelfServeBilling?: boolean;
  freeTrialDate?: Date;
  enterprise?: boolean;
  /** @deprecated */
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
  installationName?: string;
  autoApproveMembers?: boolean;
  members: Member[];
  invites: Invite[];
  pendingMembers?: PendingMember[];
  connections?: OrganizationConnections;
  settings?: OrganizationSettings;
  messages?: OrganizationMessage[];
  getStartedChecklistItems?: string[];
  customRoles?: Role[];
  deactivatedRoles?: string[];
  disabled?: boolean;
  setupEventTracker?: string;
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

export type GetOrganizationResponse = {
  status: 200;
  organization: OrganizationInterface;
  members: ExpandedMember[];
  seatsInUse: number;
  roles: Role[];
  agreements: AgreementType[];
  apiKeys: ApiKeyInterface[];
  enterpriseSSO: Partial<SSOConnectionInterface> | null;
  accountPlan: AccountPlan;
  effectiveAccountPlan: AccountPlan;
  commercialFeatureLowestPlan?: Partial<Record<CommercialFeature, AccountPlan>>;
  licenseError: string;
  commercialFeatures: CommercialFeature[];
  license: Partial<LicenseInterface> | null;
  installationName: string | null;
  subscription: SubscriptionInfo | null;
  licenseKey?: string;
  currentUserPermissions: UserPermissions;
  teams: TeamInterface[];
  watching: {
    experiments: string[];
    features: string[];
  };
  usage: OrganizationUsage;
};

export type DailyUsage = {
  date: string;
  requests: number;
  bandwidth: number;
  managedClickhouseEvents: number;
};

type UsageLimit = number | "unlimited";

export type UsageLimits = {
  cdnRequests: UsageLimit;
  cdnBandwidth: UsageLimit;
  managedClickhouseEvents?: UsageLimit;
};

export type OrganizationUsage = {
  limits: {
    requests: UsageLimit;
    bandwidth: UsageLimit;
    managedClickhouseEvents?: UsageLimit;
  };
  cdn: {
    lastUpdated: Date;
    status: "under" | "approaching" | "over";
  };
  managedClickhouse?: {
    lastUpdated: Date;
    status: "under" | "approaching" | "over";
  };
};
