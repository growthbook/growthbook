import {
  ReadAccessFilter,
  getApiKeyReadAccessFilter,
  getReadAccessFilter,
} from "shared/permissions";
import { MemberRole, OrganizationInterface } from "../../types/organization";
import { EventAuditUser } from "../events/event-types";
import { getUserPermissions } from "../util/organization.util";
import { TeamInterface } from "../../types/team";
import { FactMetricDataModel } from "../models/FactMetricModel";
import { getEnvironmentIdsFromOrg } from "./organizations";

export class ReqContextClass {
  public org: OrganizationInterface;
  public userId = "";
  public email = "";
  public userName = "";
  public isApiRequest = false;
  public environments: string[];
  public readAccessFilter: ReadAccessFilter;
  public auditUser: EventAuditUser;

  // Models
  public factMetrics: FactMetricDataModel;

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

    this.factMetrics = new FactMetricDataModel(this);
  }
}
