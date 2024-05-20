import { Permissions, userHasPermission } from "shared/permissions";
import { uniq } from "lodash";
import type pino from "pino";
import type { Request } from "express";
import { CommercialFeature, orgHasPremiumFeature } from "enterprise";
import {
  OrganizationInterface,
  Permission,
  UserPermissions,
} from "../../types/organization";
import { EventAuditUser } from "../events/event-types";
import {
  getUserPermissions,
  roleToPermissionMap,
  getEnvironmentIdsFromOrg,
} from "../util/organization.util";
import { TeamInterface } from "../../types/team";
import { FactMetricModel } from "../models/FactMetricModel";
import { ProjectInterface } from "../../types/project";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { addTags, getAllTags } from "../models/TagModel";
import { AuditInterface } from "../../types/audit";
import { insertAudit } from "../models/AuditModel";
import { logger } from "../util/logger";

export class ReqContextClass {
  // Models
  public models!: {
    factMetrics: FactMetricModel;
  };
  private initModels() {
    this.models = {
      factMetrics: new FactMetricModel(this),
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
  public auditUser: EventAuditUser;
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
    auditUser: EventAuditUser;
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
      this.userPermissions = getUserPermissions(user.id, org, teams || []);
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

    this.permissions = new Permissions(this.userPermissions, this.superAdmin);

    this.initModels();
  }

  // Check permissions
  public hasPermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>
  ) {
    return userHasPermission(
      this.superAdmin,
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
  public async auditLog(
    data: Omit<AuditInterface, "user" | "id" | "organization" | "dateCreated">
  ) {
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

  // Cache projects since they are needed many places in the code
  private _projects: ProjectInterface[] | null = null;
  public async getProjects() {
    if (this._projects === null) {
      this._projects = await findAllProjectsByOrganization(this);
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
