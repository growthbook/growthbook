import { NextFunction, Request, Response } from "express";
import { JWT_SECRET } from "../../util/secrets";
import { AuthConnection, TokensResponse } from "./AuthConnection";
import jwtExpress from "express-jwt";
import jwt from "jsonwebtoken";
import { UserInterface } from "../../../types/user";
import {
  AuthRefreshModel,
  createRefreshToken,
  getUserIdFromAuthRefreshToken,
} from "../../models/AuthRefreshModel";
import { RefreshTokenCookie } from "../../util/cookie";
import { UnauthenticatedResponse } from "../../../types/sso-connection";
import { isNewInstallation } from ".";
import { getUserById } from "../users";

export class LocalAuthConnection implements AuthConnection {
  middleware(req: Request, res: Response, next: NextFunction): void {
    if (!JWT_SECRET) {
      throw new Error("Must specify JWT_SECRET environment variable");
    }
    const jwtCheck = jwtExpress({
      secret: JWT_SECRET,
      audience: "https://api.growthbook.io",
      issuer: "https://api.growthbook.io",
      algorithms: ["HS256"],
    });
    jwtCheck(req, res, next);
  }
  async processCallback(
    req: Request,
    res: Response,
    user: UserInterface
  ): Promise<TokensResponse> {
    const idToken = this.generateJWT(user);
    const refreshToken = await createRefreshToken(req, user);
    return { idToken, refreshToken, expiresIn: 1800 };
  }
  async logout(req: Request): Promise<string> {
    const refreshToken = RefreshTokenCookie.getValue(req);
    if (refreshToken) {
      await AuthRefreshModel.deleteOne({
        token: refreshToken,
      });
    }
    return "";
  }
  async getUnauthenticatedResponse(): Promise<UnauthenticatedResponse> {
    const newInstallation = await isNewInstallation();
    return {
      showLogin: true,
      newInstallation,
    };
  }
  async refresh(
    req: Request,
    res: Response,
    refreshToken: string
  ): Promise<TokensResponse> {
    const userId = await getUserIdFromAuthRefreshToken(refreshToken);
    if (!userId) {
      throw new Error("No user found with that refresh token");
    }

    const user = await getUserById(userId);
    if (!user) {
      throw new Error("Invalid user id - " + userId);
    }

    return {
      idToken: this.generateJWT(user),
      refreshToken,
      expiresIn: 1800,
    };
  }
  private generateJWT(user: UserInterface) {
    return jwt.sign(
      {
        scope: "profile openid email",
        email: user.email,
        given_name: user.name,
        email_verified: false,
      },
      JWT_SECRET,
      {
        algorithm: "HS256",
        audience: "https://api.growthbook.io",
        issuer: "https://api.growthbook.io",
        subject: user.id,
        // 30 minutes
        expiresIn: 1800,
      }
    );
  }
}
