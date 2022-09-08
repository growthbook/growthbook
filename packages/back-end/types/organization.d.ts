import Stripe from "stripe";
import { ImplementationType } from "./experiment";

export type Permissions = {
  addComments: boolean;
  runQueries: boolean;
  createPresentations: boolean;
  createIdeas: boolean;
  createAnalyses: boolean;
  createMetrics: boolean;
  createDimensions: boolean;
  createSegments: boolean;
  editDatasourceSettings: boolean;
  publishFeatures: boolean;
  createFeatures: boolean;
  createFeatureDrafts: boolean;
  organizationSettings: boolean;
  createDatasources: boolean;
  superDelete: boolean;
};

export type MemberRole =
  | "readonly"
  | "collaborator"
  | "designer"
  | "analyst"
  | "developer"
  | "engineer"
  | "experimenter"
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
  qty: number;
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
  claimedDomain?: string;
  name: string;
  ownerEmail: string;
  stripeCustomerId?: string;
  restrictLoginMethod?: string;
  freeSeats?: number;
  discountCode?: string;
  priceId?: string;
  disableSelfServeBilling?: boolean;
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
