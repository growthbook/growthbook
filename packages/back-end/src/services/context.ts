import { Permissions, userHasPermission } from "shared/permissions";
import { uniq } from "lodash";
import type pino from "pino";
import type { Request } from "express";
import { CommercialFeature, orgHasPremiumFeature } from "enterprise";
import { ExperimentMetricInterface } from "shared/experiments";
import { MetricAnalysisModel } from "back-end/src/models/MetricAnalysisModel";
import {
  OrganizationInterface,
  Permission,
  UserPermissions,
} from "back-end/types/organization";
import { EventUser } from "back-end/src/events/event-types";
import {
  getUserPermissions,
  roleToPermissionMap,
  getEnvironmentIdsFromOrg,
} from "back-end/src/util/organization.util";
import { TeamInterface } from "back-end/types/team";
import { FactMetricModel } from "back-end/src/models/FactMetricModel";
import { ProjectModel } from "back-end/src/models/ProjectModel";
import { ProjectInterface } from "back-end/types/project";
import { addTags, getAllTags } from "back-end/src/models/TagModel";
import { AuditInterfaceInput } from "back-end/types/audit";
import { insertAudit } from "back-end/src/models/AuditModel";
import { logger } from "back-end/src/util/logger";
import { UrlRedirectModel } from "back-end/src/models/UrlRedirectModel";
import { ExperimentInterface } from "back-end/types/experiment";
import { DataSourceInterface } from "back-end/types/datasource";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { SegmentModel } from "back-end/src/models/SegmentModel";
import { MetricGroupModel } from "back-end/src/models/MetricGroupModel";
import { getExperimentMetricsByIds } from "./experiments";

export type ForeignRefTypes = {
  experiment: ExperimentInterface;
  datasource: DataSourceInterface;
  metric: ExperimentMetricInterface;
};

export class ReqContextClass {
  // Models
  public models!: {
    factMetrics: FactMetricModel;
    projects: ProjectModel;
    urlRedirects: UrlRedirectModel;
    metricAnalysis: MetricAnalysisModel;
    metricGroups: MetricGroupModel;
    segments: SegmentModel;
  };
  private initModels() {
    this.models = {
      factMetrics: new FactMetricModel(this),
      projects: new ProjectModel(this),
      urlRedirects: new UrlRedirectModel(this),
      metricAnalysis: new MetricAnalysisModel(this),
      metricGroups: new MetricGroupModel(this),
      segments: new SegmentModel(this),
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
    envs?: string[] | Set<string>
  ) {
    return userHasPermission(
      this.userPermissions,
      permission,
      project,
      envs ? [...envs] : undefined
    );
  }

  // Helper if you want to throw an error if the user does not have permission
  public requirePermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>
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
      : null;
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
  };
  public async populateForeignRefs({
    experiment,
    datasource,
    metric,
  }: ForeignRefsCacheKeys) {
    await this.addMissingForeignRefs("experiment", experiment, (ids) =>
      getExperimentsByIds(this, ids)
    );
    // An org doesn't have that many data sources, so we just fetch them all
    await this.addMissingForeignRefs("datasource", datasource, () =>
      getDataSourcesByOrganization(this)
    );
    await this.addMissingForeignRefs("metric", metric, (ids) =>
      getExperimentMetricsByIds(this, ids)
    );
  }
  private async addMissingForeignRefs<K extends keyof ForeignRefsCache>(
    type: K,
    ids: string[] | undefined,
    getter: (ids: string[]) => Promise<ForeignRefTypes[K][]>
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
