import { Request, Response, NextFunction } from "express";
import * as z from "zod";

export const validatePostFeatureReq = () => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { featureId } = req.params;
    if (!featureId) throw new Error("Missing featureId in url params");

    const FeatureValueType = z.union([
      z.literal("boolean"),
      z.literal("string"),
      z.literal("number"),
      z.literal("json"),
    ]);

    const BaseRule = z.object({
      id: z.string(),
      description: z.string(),
      condition: z
        .string()
        .optional()
        .and(z.custom((v) => JSON.parse(v as string))),
      enabled: z.boolean().optional(),
    });

    const ForceRule = BaseRule.extend({
      type: z.literal("force"),
      value: z.string(),
    });

    const RolloutRule = BaseRule.extend({
      type: z.literal("rollout"),
      value: z.string(),
      coverage: z.number().min(0).max(1),
      hashAttribute: z.string(),
    });

    const ExperimentRule = BaseRule.extend({
      type: z.literal("experiment"),
      trackingKey: z.string(),
      hashAttribute: z.string(),
      values: z.array(
        z.object({
          value: z.string(),
          weight: z.number().min(0).max(1),
          name: z.string().optional(),
        })
      ),
      namespace: z
        .object({
          enabled: z.boolean(),
          name: z.string(),
          range: z.array(z.number()).length(2),
        })
        .optional(),
      coverage: z.number().min(0).max(1).optional(),
    });

    const FeatureRule = z.union([ForceRule, RolloutRule, ExperimentRule]);

    const FeatureDraftChanges = z.object({
      active: z.boolean(),
      dateCreated: z.date().optional(),
      dateUpdated: z.date().optional(),
      defaultValue: z.string().optional(),
      rules: z.record(z.string(), z.array(FeatureRule)).optional(),
      comment: z.string().optional(),
    });

    const UserRef = z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
    });

    const FeatureRevisionInterface = z.object({
      version: z.number(),
      comment: z.string(),
      date: z.date(),
      publishedBy: UserRef,
    });

    //prop 'id' is passed as a url param, not in the body
    //props 'dateCreated' and 'dateUpdated' are set upon creation
    const featureSchema = z.object({
      archived: z.boolean().optional(),
      description: z.string().optional(),
      owner: z.string(),
      project: z.string().optional(),
      valueType: FeatureValueType,
      defaultValue: z.string(),
      tags: z.array(z.string()).optional(),
      environmentSettings: z
        .record(
          z.string(),
          z.object({
            enabled: z.boolean(),
            rules: z.array(FeatureRule),
          })
        )
        .optional(),
      draft: FeatureDraftChanges.optional(),
      revision: FeatureRevisionInterface.optional(),
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
