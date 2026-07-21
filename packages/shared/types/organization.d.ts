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
  OrgLimits,
  SubscriptionInfo,
} from "shared/enterprise";
import { AIModel, EmbeddingModel } from "shared/ai";
import {
  AgreementType,
  environment,
  expandedMember,
  expandedMemberInfo,
  invite,
  member,
  memberRoleInfo,
  memberRoleWithProjects,
  pendingMember,
  projectMemberRole,
} from "shared/validators";
import { SSOConnectionInterface } from "shared/types/sso-connection";
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
  featureRequireEnvironmentReview?: boolean;
  featureRequireMetadataReview?: boolean;
  // When true, co-authors (contributors[]) are also blocked from approving, not just the original author.
  blockSelfApproval?: boolean;
  autopublishOnApproval?: boolean;
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

/** Custom role IDs defined by orgs in org.customRoles */
export type CustomRole = string;

/** A member's role is either a built-in default or a custom role ID */
export type MemberRole = DefaultMemberRole | CustomRole;

export type Role = {
  id: string;
  description: string;
  policies: Policy[];
  displayName?: string;
};

export type MemberRoleInfo = z.infer<typeof memberRoleInfo>;

export type ProjectMemberRole = z.infer<typeof projectMemberRole>;

export type MemberRoleWithProjects = z.infer<typeof memberRoleWithProjects>;

export type Invite = z.infer<typeof invite>;

export type PendingMember = z.infer<typeof pendingMember>;

export type Member = z.infer<typeof member>;

export type ExpandedMemberInfo = z.infer<
  z.ZodObject<typeof expandedMemberInfo>
>;

export type ExpandedMember = z.infer<typeof expandedMember>;

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

export type NamespaceFormat = NonNullable<Namespaces["format"]>;

export interface NamespaceBase {
  name: string;
  label: string;
  description: string;
  status: "active" | "inactive";
}

export interface LegacyNamespace extends NamespaceBase {
  format?: "legacy";
}

export interface MultiRangeNamespace extends NamespaceBase {
  format: "multiRange";
  hashAttribute: string;
  seed: string;
}

export type Namespaces = LegacyNamespace | MultiRangeNamespace;

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
  tags?: string[];
};

export type SDKAttributeSchema = SDKAttribute[];

export type ExperimentUpdateSchedule = {
  type: "cron" | "never" | "stale";
  cron?: string;
  hours?: number;
};

export type Environment = z.infer<typeof environment>;

export type ApprovalFlowConfiguration = {
  requireMetadataReview: boolean;
  required: boolean;
  // When true, anyone listed in `revision.contributors` (including the author)
  // is blocked from approving the revision. A separate, non-contributor
  // reviewer is required.
  blockSelfApproval?: boolean;
  autopublishOnApproval?: boolean;
  // TODO: Should we add support for these additional settings?
  canBypassReview?: boolean;
  resetReviewOnChange?: boolean;
};

export type ApprovalFlowConfigurations = {
  savedGroups: ApprovalFlowConfiguration[];
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
  aiEnabled?: boolean;
  disableAutoHypothesisCheck?: boolean;
  defaultAIModel?: AIModel;
  embeddingModel?: EmbeddingModel;
  /** @deprecated */
  openAIDefaultModel?: AIModel;
  // Per-surface overrides for the Visual Editor. Image model is a free
  // string (not AIModel) because Gemini image-model ids live in their
  // own namespace and rev independently of the text-model union.
  visualEditorAIModel?: AIModel;
  visualEditorImageModel?: string;
  // Free-text brand guidelines appended to the Visual Editor AI system
  // prompt (e.g. tone, brand colors, button casing).
  visualEditorAIContext?: string;
  implementationTypes?: ImplementationType[];
  attributionModel?: AttributionModel;
  sequentialTestingEnabled?: boolean;
  sequentialTestingTuningParameter?: number;
  displayCurrency?: string;
  secureAttributeSalt?: string;
  /** @deprecated */
  killswitchConfirmation?: boolean;
  requireReviews?: boolean | RequireReview[];
  // Default extensibility for newly authored configs. When true (default),
  // base configs allow child configs / feature rules to add extra keys unless
  // a config explicitly opts out via its own `extensible` flag.
  configsExtensibleByDefault?: boolean;
  // Default value of the per-config "experiment guard" for newly created configs.
  // The guard soft-blocks publishing a config whose value is served to a running
  // experiment. Seeded onto each config at creation (a concrete per-config flag),
  // so changing this default doesn't retroactively affect existing configs.
  // Absent = off.
  configExperimentGuardDefault?: boolean;
  // Whether publishing a revision is BLOCKED when its values don't match the
  // JSON schema (features and configs). Per-write validation always runs (opt
  // out per request with ?skipSchemaValidation=true); this governs the re-check
  // at publish, which catches values that became invalid after the fact (e.g. a
  // schema change, an ancestor-config change, or a value staged with the skip
  // flag). true (default) blocks the publish; false surfaces a bypassable soft
  // warning instead. Absent = true.
  blockPublishOnSchemaError?: boolean;
  // When enabled, a feature draft whose base version is behind the current
  // live version (or whose approval has gone stale) must be rebased
  // ("Rebase with live") before it can be published.
  requireRebaseBeforePublish?: boolean;
  // When enabled, anyone with publish permission can revert to a previously
  // published revision and publish it immediately, even when approvals are
  // otherwise required. Reverts restore an already-reviewed state, so the
  // revert UI defaults to "Publish now". Applies to features and saved groups.
  revertsBypassApproval?: boolean;
  // Soft cap on active (unpublished, non-discarded) drafts per feature.
  // Advisory only: the UI warns and asks for confirmation, REST returns an
  // escapable 409 (`overrideDraftLimit=true`), and automated processes
  // (ramps, experiment linkages, reverts, reopens) ignore it entirely.
  // 0 or absent = no cap.
  maxConcurrentDrafts?: number;
  restApiBypassesReviews?: boolean;
  defaultDataSource?: string;
  testQueryDays?: number;
  disablePrecomputedDimensions?: boolean;
  useStickyBucketing?: boolean;
  useFallbackAttributes?: boolean;
  codeReferencesEnabled?: boolean;
  codeRefsBranchesToFilter?: string[];
  codeRefsPlatformUrl?: string;
  featureKeyExample?: string; // Example Key of feature flag (e.g. "feature-20240201-name")
  featureRegexValidator?: string; // Regex to validate feature flag name (e.g. ^.+-\d{8}-.+$)
  // When enabled, new JSON feature-flag rules start in "sparse patch" mode (the
  // rule value is a partial object merged onto the feature's default value).
  // The rule editor opens already in sparse mode with a clean-slate value.
  // Only affects new rules on eligible JSON features; off by default.
  sparseJSONRulesByDefault?: boolean;
  requireProjectForFeatures?: boolean;
  requireProjectForSdkConnections?: boolean;
  // When true, saving a feature rule or experiment rejects hashAttribute,
  // fallbackAttribute, or condition keys that don't appear (unarchived) in
  // attributeSchema. Prevents typo'd attributes silently never matching at
  // eval time. Mirrors the existing saved-group "Unknown attributeKey" check.
  // Two-toggle gate for the opt-in attribute registration check. Stored as
  // an object so we can split the "must be a registered attribute" check
  // from the stricter "must also be scoped to this project" check. The
  // legacy boolean shape is still accepted on read for back-compat —
  // `getRequireRegisteredAttributesSettings` normalizes both into the
  // canonical { isOn, requireProjectScoping } pair.
  requireRegisteredAttributes?:
    | boolean
    | { isOn: boolean; requireProjectScoping: boolean };
  featureListMarkdown?: string;
  featurePageMarkdown?: string;
  experimentListMarkdown?: string;
  experimentPageMarkdown?: string;
  metricListMarkdown?: string;
  metricPageMarkdown?: string;
  preferredEnvironment?: string | null; // null (or undefined) means "remember previous environment"
  maxMetricSliceLevels?: number;
  topValuesLookbackValue?: number;
  topValuesLookbackUnit?: "days";
  banditScheduleValue?: number;
  banditScheduleUnit?: "hours" | "days";
  banditBurnInValue?: number;
  banditBurnInUnit?: "hours" | "days";
  requireExperimentTemplates?: boolean;
  requireUniqueExperimentTrackingKeys?: boolean;
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
  approvalFlows?: ApprovalFlowConfigurations;
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
  licenseKey?: string;
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
  suspended?: boolean;
  setupEventTracker?: string;
  limits?: OrgLimits;
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
