import { Request, Response, NextFunction } from "express";
import * as z from "zod";

export const validatePutFeatureReq = () => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { featureId } = req.params;
    if (!featureId) throw new Error("Feature ID is required");

    const featureSchema = z.object({
      description: z.string().optional(),
      owner: z.string().optional(),
      project: z.string().optional(),
      tags: z.array(z.string()).optional(),
    });

    featureSchema.parse(req.body);

    return next();
  } catch (err) {
    console.error(err);
    return err instanceof z.ZodError
      ? res.status(400).json({ status: 400, message: err.format() })
      : res.status(400).json({ status: 400, message: err.message });
  }
};
