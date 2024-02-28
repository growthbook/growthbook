import {
  ReadAccessFilter,
  getApiKeyReadAccessFilter,
  getReadAccessFilter,
} from "shared/permissions";
import { uniq } from "lodash";
import { MemberRole, OrganizationInterface } from "../../types/organization";
import { EventAuditUser } from "../events/event-types";
import { getUserPermissions } from "../util/organization.util";
import { TeamInterface } from "../../types/team";
import { FactMetricDataModel } from "../models/FactMetricModel";
import { ProjectInterface } from "../../types/project";
import { findAllProjectsByOrganization } from "../models/ProjectModel";
import { addTags, getAllTags } from "../models/TagModel";
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
  public isApiRequest = false;
  public environments: string[];
  public readAccessFilter: ReadAccessFilter;
  public auditUser: EventAuditUser;

  public constructor({
    org,
    auditUser,
    teams,
    user,
    role,
  }: {
    org: OrganizationInterface;
    user?: {
      id: string;
      email: string;
      name?: string;
    };
    role?: MemberRole;
    teams?: TeamInterface[];
    auditUser: EventAuditUser;
  }) {
    this.org = org;
    this.environments = getEnvironmentIdsFromOrg(org);
    this.auditUser = auditUser;

    this.isApiRequest = auditUser?.type === "api_key";

    if (user) {
      this.userId = user.id;
      this.email = user.email;
      this.userName = user.name || "";
      this.readAccessFilter = getReadAccessFilter(
        getUserPermissions(user.id, org, teams || [])
      );
    } else {
      this.readAccessFilter = getApiKeyReadAccessFilter(role || "admin");
    }

    this.addModels();
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
