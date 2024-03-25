import type { ReadAccessFilter } from "shared/permissions";
import type pino from "pino";
import type { Request } from "express";
import { Permissions } from "shared/permissions";
import type { EventAuditUser } from "@back-end/srcevents/event-types";
import { MemberRole, OrganizationInterface, Permission } from "./organization";
import { TeamInterface } from "./team";
import { AuditInterface } from "./audit";
import { ProjectInterface } from "./project";

export interface ReqContextInterface {
  org: OrganizationInterface;
  userId: string;
  email: string;
  userName: string;
  superAdmin: boolean;
  teams: TeamInterface[];
  role?: MemberRole;
  isApiRequest: boolean;
  environments: string[];
  readAccessFilter: ReadAccessFilter;
  auditUser: EventAuditUser;
  apiKey?: string;
  req?: Request;
  logger: pino.BaseLogger;
  permissions: Permissions;

  hasPermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>
  ): boolean;

  requirePermission(
    permission: Permission,
    project?: string | (string | undefined)[] | undefined,
    envs?: string[] | Set<string>
  ): void;

  auditLog(
    data: Omit<AuditInterface, "user" | "id" | "organization" | "dateCreated">
  ): Promise<void>;

  getProjects(): Promise<ProjectInterface[]>;

  registerTags(tags: string[]): Promise<void>;
}
