import {
  ReadAccessFilter,
  getReadAccessFilter,
  userHasPermission,
} from "shared/permissions";
import { uniq } from "lodash";
import {
  MemberRole,
  OrganizationInterface,
  Permission,
  UserPermissions,
} from "../../types/organization";
import { EventAuditUser } from "../events/event-types";
import {
  getUserPermissions,
  roleToPermissionMap,
} from "../util/organization.util";
import { TeamInterface } from "../../types/team";
import { FactMetricDataModel } from "../models/FactMetricModel";
import { ProjectInterface } from "../../types/project";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { addTags, getAllTags } from "../models/TagModel";
import { AuditInterface } from "../../types/audit";
import { insertAudit } from "../models/AuditModel";
import { getEnvironmentIdsFromOrg } from "./organizations";

export class ReqContextClass {
  // Models
  public models!: {
    factMetrics: FactMetricDataModel;
  };
  private addModels() {
    this.models = {
      factMetrics: new FactMetricDataModel(this),
    };
  }

  public org: OrganizationInterface;
  public userId = "";
  public email = "";
  public userName = "";
  public superAdmin = false;
  public teams: TeamInterface[] = [];
  public role?: MemberRole;
  public isApiRequest = false;
  public environments: string[];
  public readAccessFilter: ReadAccessFilter;
  public auditUser: EventAuditUser;
  public apiKey?: string;

  protected permissions: UserPermissions;

  public constructor({
    org,
    auditUser,
    teams,
    user,
    role,
    apiKey,
  }: {
    org: OrganizationInterface;
    user?: {
      id: string;
      email: string;
      name?: string;
      superAdmin?: boolean;
    };
    apiKey?: string;
    role?: MemberRole;
    teams?: TeamInterface[];
    auditUser: EventAuditUser;
  }) {
    this.org = org;
    this.environments = getEnvironmentIdsFromOrg(org);
    this.auditUser = auditUser;
    this.teams = teams || [];

    this.isApiRequest = auditUser?.type === "api_key";
    this.role = role;
    this.apiKey = apiKey;

    if (user) {
      this.userId = user.id;
      this.email = user.email;
      this.userName = user.name || "";
      this.permissions = getUserPermissions(user.id, org, teams || []);
      this.superAdmin = user.superAdmin || false;
    } else {
      this.permissions = {
        global: {
          permissions: roleToPermissionMap(role || "admin", org),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      };
    }
    this.readAccessFilter = getReadAccessFilter(this.permissions);

    this.addModels();
  }

  // Check permissions
  public hasPermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>
  ) {
    if (
      !userHasPermission(
        this.superAdmin,
        this.permissions,
        permission,
        project,
        envs ? [...envs] : undefined
      )
    ) {
      return false;
    }
  }
  public requirePermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>
  ) {
    if (!this.hasPermission(permission, project, envs)) {
      throw new Error("You do not have permission to complete that action.");
    }
  }

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
