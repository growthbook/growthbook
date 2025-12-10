import {
  Permissions,
  userHasPermission,
  roleToPermissionMap,
} from "shared/permissions";
import { uniq } from "lodash";
import type pino from "pino";
import type { Request } from "express";
import { ExperimentMetricInterface } from "shared/experiments";
import { CommercialFeature } from "shared/enterprise";
import { AuditInterfaceInput } from "shared/types/audit";
import {
  OrganizationInterface,
  Permission,
  UserPermissions,
} from "shared/types/organization";
import { EventUser } from "shared/types/events/event-types";
import { TeamInterface } from "shared/types/team";
import { ProjectInterface } from "shared/types/project";
import { ExperimentInterface } from "shared/types/experiment";
import { DataSourceInterface } from "shared/types/datasource";
import { FeatureInterface } from "shared/types/feature";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { CustomFieldModel } from "back-end/src/models/CustomFieldModel";
import { MetricAnalysisModel } from "back-end/src/models/MetricAnalysisModel";
import {
  getUserPermissions,
  getEnvironmentIdsFromOrg,
} from "back-end/src/util/organization.util";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";
import { ProjectModel } from "back-end/src/models/ProjectModel";
import { addTags, getAllTags } from "back-end/src/models/TagModel";
import { insertAudit } from "back-end/src/models/AuditModel";
import { logger } from "back-end/src/util/logger";
import { UrlRedirectModel } from "back-end/src/models/UrlRedirectModel";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { SegmentModel } from "back-end/src/models/SegmentModel";
import { MetricGroupModel } from "back-end/src/models/MetricGroupModel";
import { PopulationDataModel } from "back-end/src/models/PopulationDataModel";
import { ExperimentTemplatesModel } from "back-end/src/models/ExperimentTemplateModel";
import { SafeRolloutModel } from "back-end/src/models/SafeRolloutModel";
import { SafeRolloutSnapshotModel } from "back-end/src/models/SafeRolloutSnapshotModel";
import { IncrementalRefreshModel } from "back-end/src/models/IncrementalRefreshModel";
import { DecisionCriteriaModel } from "back-end/src/enterprise/models/DecisionCriteriaModel";
import { MetricTimeSeriesModel } from "back-end/src/models/MetricTimeSeriesModel";
import { WebhookSecretDataModel } from "back-end/src/models/WebhookSecretModel";
import { HoldoutModel } from "back-end/src/models/HoldoutModel";
import { SavedQueryDataModel } from "back-end/src/models/SavedQueryDataModel";
import { FeatureRevisionLogModel } from "back-end/src/models/FeatureRevisionLogModel";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import { AiPromptModel } from "back-end/src/enterprise/models/AIPromptModel";
import { VectorsModel } from "back-end/src/enterprise/models/VectorsModel";
import { AgreementModel } from "back-end/src/models/AgreementModel";
import { CustomHookModel } from "back-end/src/models/CustomHookModel";
import { getExperimentMetricsByIds } from "./experiments";

export type ForeignRefTypes = {
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  metric: ExperimentMetricInterface;
  feature: FeatureInterface;
};

export class ReqContextClass {
  // Models
  public models!: {
    agreements: AgreementModel;
    aiPrompts: AiPromptModel;
    customFields: CustomFieldModel;
    factMetrics: FactMetricModel;
    featureRevisionLogs: FeatureRevisionLogModel;
    projects: ProjectModel;
    urlRedirects: UrlRedirectModel;
    metricAnalysis: MetricAnalysisModel;
    populationData: PopulationDataModel;
    savedQueries: SavedQueryDataModel;
    metricGroups: MetricGroupModel;
    segments: SegmentModel;
    experimentTemplates: ExperimentTemplatesModel;
    vectors: VectorsModel;
    safeRollout: SafeRolloutModel;
    safeRolloutSnapshots: SafeRolloutSnapshotModel;
    decisionCriteria: DecisionCriteriaModel;
    metricTimeSeries: MetricTimeSeriesModel;
    webhookSecrets: WebhookSecretDataModel;
    holdout: HoldoutModel;
    dashboards: DashboardModel;
    customHooks: CustomHookModel;
    incrementalRefresh: IncrementalRefreshModel;
  };
  private initModels() {
    this.models = {
      agreements: new AgreementModel(this),
      aiPrompts: new AiPromptModel(this),
      customFields: new CustomFieldModel(this),
      factMetrics: new FactMetricModel(this),
      featureRevisionLogs: new FeatureRevisionLogModel(this),
      projects: new ProjectModel(this),
      urlRedirects: new UrlRedirectModel(this),
      metricAnalysis: new MetricAnalysisModel(this),
      populationData: new PopulationDataModel(this),
      savedQueries: new SavedQueryDataModel(this),
      metricGroups: new MetricGroupModel(this),
      segments: new SegmentModel(this),
      experimentTemplates: new ExperimentTemplatesModel(this),
      vectors: new VectorsModel(this),
      safeRollout: new SafeRolloutModel(this),
      safeRolloutSnapshots: new SafeRolloutSnapshotModel(this),
      decisionCriteria: new DecisionCriteriaModel(this),
      metricTimeSeries: new MetricTimeSeriesModel(this),
      webhookSecrets: new WebhookSecretDataModel(this),
      holdout: new HoldoutModel(this),
      dashboards: new DashboardModel(this),
      customHooks: new CustomHookModel(this),
      incrementalRefresh: new IncrementalRefreshModel(this),
    };
  }

  public org: OrganizationInterface;
  public userId = "";
  public email = "";
  public userName = "";
  public superAdmin = false;
  public teams: TeamInterface[] = [];
  public role?: string;
  public isApiRequest = false;
  public environments: string[];
  public auditUser: EventUser;
  public apiKey?: string;
  public req?: Request;
  public logger: pino.BaseLogger;
  public permissions: Permissions;

  protected userPermissions: UserPermissions;

  public constructor({
    org,
    auditUser,
    teams,
    user,
    role,
    apiKey,
    req,
  }: {
    org: OrganizationInterface;
    user?: {
      id: string;
      email: string;
      name?: string;
      superAdmin?: boolean;
    };
    apiKey?: string;
    role?: string;
    teams?: TeamInterface[];
    auditUser: EventUser;
    req?: Request;
  }) {
    this.org = org;
    this.auditUser = auditUser;
    this.teams = teams || [];

    this.isApiRequest = auditUser?.type === "api_key";
    this.role = role;
    this.apiKey = apiKey;
    this.req = req;

    if (this.req && this.req.log) {
      this.logger = this.req.log;
    } else {
      this.logger = logger;
    }

    this.environments = getEnvironmentIdsFromOrg(org);

    // If a specific user is making this request
    if (user) {
      this.userId = user.id;
      this.email = user.email;
      this.userName = user.name || "";
      this.superAdmin = user.superAdmin || false;
      this.userPermissions = getUserPermissions(user, org, teams || []);
    }
    // If an API key or background job is making this request
    else {
      if (!role) {
        throw new Error("Role must be provided for API key or background job");
      }

      this.userPermissions = {
        global: {
          permissions: roleToPermissionMap(role, org),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      };
    }

    this.permissions = new Permissions(this.userPermissions);

    this.initModels();
  }

  // Check permissions
  public hasPermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>,
  ) {
    return userHasPermission(
      this.userPermissions,
      permission,
      project,
      envs ? [...envs] : undefined,
    );
  }

  // Helper if you want to throw an error if the user does not have permission
  public requirePermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>,
  ) {
    if (!this.hasPermission(permission, project, envs)) {
      throw new Error("You do not have permission to complete that action.");
    }
  }

  public hasPremiumFeature(feature: CommercialFeature) {
    return orgHasPremiumFeature(this.org, feature);
  }

  // Record an audit log entry
  public async auditLog(data: AuditInterfaceInput) {
    const auditUser = this.userId
      ? {
          id: this.userId,
          email: this.email,
          name: this.userName || "",
        }
      : this.apiKey
        ? {
            apiKey: this.apiKey,
          }
        : ({
            system: true,
          } as const);
    if (!auditUser) {
      throw new Error("Must have user or apiKey in context to audit log");
    }
    await insertAudit({
      ...data,
      user: auditUser,
      organization: this.org.id,
      dateCreated: new Date(),
    });
  }

  // Cache common foreign references
  public foreignRefs: ForeignRefsCache = {
    experiment: new Map(),
    datasource: new Map(),
    metric: new Map(),
    feature: new Map(),
  };
  public async populateForeignRefs({
    experiment,
    datasource,
    metric,
    feature,
  }: ForeignRefsCacheKeys) {
    await this.addMissingForeignRefs("experiment", experiment, (ids) =>
      getExperimentsByIds(this, ids),
    );
    // An org doesn't have that many data sources, so we just fetch them all
    await this.addMissingForeignRefs("datasource", datasource, () =>
      getDataSourcesByOrganization(this),
    );
    await this.addMissingForeignRefs("metric", metric, (ids) =>
      getExperimentMetricsByIds(this, ids),
    );
    await this.addMissingForeignRefs("feature", feature, (ids) =>
      getFeaturesByIds(this, ids),
    );
  }
  private async addMissingForeignRefs<K extends keyof ForeignRefsCache>(
    type: K,
    ids: string[] | undefined,
    getter: (ids: string[]) => Promise<ForeignRefTypes[K][]>,
  ) {
    if (!ids) return;
    const missing = ids.filter((id) => !this.foreignRefs[type].has(id));
    if (missing.length) {
      const refs = await getter(missing);
      refs.forEach((ref) => {
        // eslint-disable-next-line
        this.foreignRefs[type].set(ref.id, ref as any);
      });
    }
  }

  // Cache projects since they are needed many places in the code
  private _projects: ProjectInterface[] | null = null;
  public async getProjects(): Promise<ProjectInterface[]> {
    if (this._projects === null) {
      const projects = await this.models.projects.getAll();
      this._projects = projects;
      return projects;
    }
    return this._projects;
  }

  // Tags can be created on the fly, so we cache which ones already exist
  private _tags: Set<string> | null = null;
  public async registerTags(tags: string[]) {
    if (!tags.length) return;

    if (this._tags === null) {
      this._tags = new Set((await getAllTags(this.org.id)).map((t) => t.id));
    }

    const newTags = uniq(tags.filter((t) => !this._tags?.has(t)));
    if (!newTags.length) return;

    await addTags(this.org.id, newTags);
    newTags.forEach((t) => this._tags?.add(t));
  }
}

// eslint-disable-next-line
export type ForeignRefsCache = {
  [key in keyof ForeignRefTypes]: Map<string, ForeignRefTypes[key]>;
};
export type ForeignRefsCacheKeys = {
  [key in keyof ForeignRefsCache]?: string[];
};
export type ForeignKeys = {
  [key in keyof ForeignRefsCache]?: string;
};
export type ForeignRefs = Partial<ForeignRefTypes>;
