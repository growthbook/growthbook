import { NextFunction, Request, Response } from "express";
import { UnauthenticatedResponse } from "shared/types/sso-connection";
import { AuthRequest } from "back-end/src/types/AuthRequest";

export type TokensResponse = {
  idToken: string;
  refreshToken: string;
  expiresIn: number;
};

export interface AuthConnection {
  refresh(
    req: Request,
    res: Response,
    refreshToken: string,
  ): Promise<TokensResponse>;
  getUnauthenticatedResponse(
    req: Request,
    res: Response,
  ): Promise<UnauthenticatedResponse>;
  middleware(
    // eslint-disable-next-line
    req: AuthRequest<any, any, any>,
    res: Response,
    next: NextFunction,
  ): void;
  processCallback(
    req: Request,
    res: Response,
    data: unknown,
  ): Promise<TokensResponse>;
  // Returns the URL to redirect to in order to complete the logout
  logout(req: Request, res: Response): Promise<string>;
}
