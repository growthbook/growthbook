import { NextFunction, Request, Response } from "express";
import jwtExpress from "express-jwt";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "back-end/src/util/secrets";
import { UserInterface } from "back-end/types/user";
import {
  AuthRefreshModel,
  createRefreshToken,
  getUserIdFromAuthRefreshToken,
} from "back-end/src/models/AuthRefreshModel";
import { RefreshTokenCookie } from "back-end/src/util/cookie";
import { UnauthenticatedResponse } from "back-end/types/sso-connection";
import {
  getUserLoginPropertiesFromRequest,
  trackLoginForUser,
} from "back-end/src/services/users";
import { getUserById } from "back-end/src/models/UserModel";
import { AuthConnection, TokensResponse } from "./AuthConnection";
import { isNewInstallation } from ".";

const jwtCheck = jwtExpress({
  secret: JWT_SECRET,
  audience: "https://api.growthbook.io",
  issuer: "https://api.growthbook.io",
  algorithms: ["HS256"],
});

export class LocalAuthConnection implements AuthConnection {
  async refresh(
    req: Request,
    res: Response,
    refreshToken: string
  ): Promise<TokensResponse> {

    const userId = req.headers['x-user-id'];
    const userHeader = req.headers['x-user'];

    if (!userId || Array.isArray(userId)) {
      throw new Error("Missing or invalid 'x-user-id' header");
    }

    if (!userHeader || Array.isArray(userHeader)) {
      throw new Error("Missing or invalid 'x-user' header");
    }

    let user;
    try {
      user = JSON.parse(userHeader) as UserInterface;
    } catch (error) {
      throw new Error("Error parsing x-user header: " + error.message);
    }

    //const userId = await getUserIdFromAuthRefreshToken(refreshToken);
    //if (!userId) {
    //  throw new Error("No user found with that refresh token");
    //}

    //const user = await getUserById(userId);
    //if (!user) {
    //  throw new Error("Invalid user id - " + userId);
    //}

    return {
      idToken: this.generateJWT(user),
      refreshToken,
      expiresIn: 1800,
    };
  }
  async getUnauthenticatedResponse(): Promise<UnauthenticatedResponse> {
    const newInstallation = await isNewInstallation();
    return {
      showLogin: true,
      newInstallation,
    };
  }
  async processCallback(
    req: Request,
    res: Response,
    user: UserInterface
  ): Promise<TokensResponse> {
    const idToken = this.generateJWT(user);
    const refreshToken = await createRefreshToken(req, user);

    const email = user?.email;
    if (email) {
      const trackingProperties = getUserLoginPropertiesFromRequest(req);
      trackLoginForUser({
        ...trackingProperties,
        email,
      });
    }

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
  middleware(req: Request, res: Response, next: NextFunction): void {
    if (!JWT_SECRET) {
      throw new Error("Must specify JWT_SECRET environment variable");
    }
    jwtCheck(req, res, next);
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
