import { Request, Response, NextFunction } from "express";
import { getOrgByAccessTokenReq } from "../services/organizations";

export const validateAccessTokenApiReq = () => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    await getOrgByAccessTokenReq(req);
    return next();
  } catch (err) {
    console.error(err);
    return res.status(400).json({ status: 400, message: err.message });
  }
};

export default validateAccessTokenApiReq;
