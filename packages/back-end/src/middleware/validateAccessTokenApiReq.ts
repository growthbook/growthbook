import { Response, NextFunction } from "express";
import { processAccessToken } from "../services/auth";
import { AccessTokenRequest } from "../types/AccessTokenRequest";

export const validateAccessTokenApiReq = () => async (
  req: AccessTokenRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    return processAccessToken(req, res, next);
  } catch (err) {
    console.error(err);
    return res.status(400).json({ status: 400, message: err.message });
  }
};

export default validateAccessTokenApiReq;
