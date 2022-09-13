import { NextFunction, Request, Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { UnauthenticatedResponse } from "../../../types/sso-connection";

export type TokensResponse = {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
};

export interface AuthConnection {
  refresh(
    req: Request,
    res: Response,
    refreshToken: string
  ): Promise<TokensResponse>;
  getUnauthenticatedResponse(
    req: Request,
    res: Response
  ): Promise<UnauthenticatedResponse>;
  middleware(req: AuthRequest, res: Response, next: NextFunction): void;
  processCallback(
    req: Request,
    res: Response,
    data: unknown
  ): Promise<TokensResponse>;
  logout(req: Request, res: Response): Promise<string>;
}
