import { Request, Response } from "express";
import { OrganizationInterface } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { SSOConnectionInterface } from "../../types/sso-connection";
import { TeamInterface } from "../../types/team";
import { UserInterface } from "../../types/user";

// eslint-disable-next-line
export type AuthRequest<
  Body = unknown,
  Params = unknown,
  QueryParams = unknown
> = Request<Params, unknown, Body, QueryParams> & {
  currentUser: Pick<
    UserInterface,
    "email" | "id" | "name" | "verified" | "superAdmin"
  >;
  email: string;
  verified?: boolean;
  userId?: string;
  loginMethod?: SSOConnectionInterface;
  authSubject?: string;
  name?: string;
  superAdmin?: boolean;
  organization?: OrganizationInterface;
  teams: TeamInterface[];
  audit: (
    data: Omit<AuditInterface, "organization" | "id" | "user" | "dateCreated">
  ) => Promise<void>;
};

export type ResponseWithStatusAndError<T = unknown> = Response<
  | (T & { status: 200 })
  | { status: 400 | 401 | 403 | 404 | 405 | 406; message: string }
>;
