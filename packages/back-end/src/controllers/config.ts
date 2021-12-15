import { Request, Response } from "express";
import { getExperimentsByOrganization } from "../services/experiments";
import { lookupOrganizationByApiKey } from "../services/apiKey";
import fs from "fs";
import path from "path";
import { APP_ORIGIN } from "../util/secrets";
import { ExperimentInterface } from "../../types/experiment";
import {
  ErrorResponse,
  ExperimentOverridesResponse,
  FeatureDefinition,
  FeatureDefinitionRule,
} from "../../types/api";
import { getExperimentOverrides } from "../services/organizations";
import { getAllFeatures } from "../models/FeatureModel";
import { FeatureValueType } from "../../types/feature";

export function canAutoAssignExperiment(
  experiment: ExperimentInterface
): boolean {
  if (!experiment.targetURLRegex) return false;

  return (
    experiment.variations.filter(
      (v) => (v.dom && v.dom.length > 0) || (v.css && v.css.length > 0)
    ).length > 0
  );
}

// eslint-disable-next-line
function getJSONValue(type: FeatureValueType, value: string): any {
  if (type === "json") return JSON.parse(value);
  if (type === "number") return parseFloat(value);
  if (type === "string") return value;
  if (type === "boolean") return value === "false" ? false : true;
  return null;
}

export async function getExperimentConfig(
  req: Request<{ key: string }>,
  res: Response<ExperimentOverridesResponse | ErrorResponse>
) {
  const { key } = req.params;

  try {
    const organization = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res.status(400).json({
        status: 400,
        error: "Invalid API key",
      });
    }

    const overrides = await getExperimentOverrides(organization);
    const flags = await getAllFeatures(organization);

    const features: Record<string, FeatureDefinition> = {};
    flags.forEach((flag) => {
      features[flag.id] = {
        defaultValue: getJSONValue(flag.valueType, flag.defaultValue),
        rules:
          flag.rules
            ?.filter((r) => r.enabled)
            ?.map((r) => {
              const rule: FeatureDefinitionRule = {};
              if (r.condition) {
                rule.condition = JSON.parse(r.condition);
              }

              if (r.type === "force") {
                rule.type = "force";
                rule.value = getJSONValue(flag.valueType, r.value);
              } else if (r.type === "rollout") {
                rule.type = "experiment";
                rule.variations = r.values.map((v) =>
                  getJSONValue(flag.valueType, v.value)
                );

                const totalWeight = r.values.reduce(
                  (sum, r) => sum + r.weight,
                  0
                );
                let multiplier = 1;
                if (totalWeight < 1 && totalWeight > 0) {
                  rule.coverage = totalWeight;
                  multiplier = 1 / totalWeight;
                }

                rule.weights = r.values.map((v) => v.weight * multiplier);
                if (r.trackingKey) {
                  rule.trackingKey = r.trackingKey;
                }
                if (r.hashAttribute) {
                  rule.hashAttribute = r.hashAttribute;
                }
              }
              return rule;
            }) ?? [],
      };
    });

    // TODO: add cache headers?
    res.status(200).json({
      status: 200,
      overrides,
      features,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({
      status: 400,
      error: "Failed to get experiment config",
    });
  }
}

type ExperimentData = {
  key: string;
  variationCode: string[];
  weights?: number[];
  coverage?: number;
  groups?: string[];
  url?: string;
  force?: number;
  draft: boolean;
  anon: boolean;
};

type CompressedExperimentOptions = {
  w?: number[];
  u: string;
  g?: string[];
  f?: number;
  d?: number;
  a?: number;
};

const baseScript = fs
  .readFileSync(path.join(__dirname, "..", "templates", "javascript.js"))
  .toString("utf-8")
  .replace(/.*eslint-.*\n/g, "")
  .replace(/\n\/\/.*/g, "");

export async function getExperimentsScript(
  req: Request<{ key: string }>,
  res: Response
) {
  res.setHeader("Content-Type", "text/javascript");
  const { key } = req.params;

  try {
    const organization = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res
        .status(400)
        .send(`console.error("Invalid GrowthBook API key");`);
    }
    const experiments = await getExperimentsByOrganization(organization);

    const experimentData: ExperimentData[] = [];

    experiments.forEach((exp) => {
      if (exp.archived) {
        return;
      }
      if (exp.implementation !== "visual") {
        return;
      }

      const key = exp.trackingKey || exp.id;
      const groups: string[] = [];

      const phase = exp.phases[exp.phases.length - 1];
      if (phase && phase.groups && phase.groups.length > 0) {
        groups.push(...phase.groups);
      }

      const data: ExperimentData = {
        key,
        draft: exp.status === "draft",
        anon: exp.userIdType === "anonymous",
        variationCode: exp.variations.map((v) => {
          const commands: string[] = [];
          if (v.css) {
            commands.push("injectStyles(" + JSON.stringify(v.css) + ")");
          }
          if (v.dom) {
            v.dom.forEach((dom) => {
              commands.push(
                "mutate.declarative(" + JSON.stringify(dom) + ").revert"
              );
            });
          }
          return "[" + commands.join(",") + "]";
        }),
      };

      if (exp.targetURLRegex) {
        data.url = exp.targetURLRegex;
      }

      if (groups.length) {
        data.groups = groups;
      }

      if (phase) {
        data.coverage = phase.coverage;
        data.weights = phase.variationWeights;
      }

      if (!data.weights) {
        data.weights = Array(exp.variations.length).fill(
          1 / exp.variations.length
        );
      }

      if (exp.status === "stopped") {
        if (exp.results === "won") {
          data.force = exp.winner;
        } else {
          data.force = 0;
        }
      }

      if (exp.status === "running") {
        if (!phase) return;
      }

      experimentData.push(data);
    });

    res.setHeader("Cache-Control", "max-age=600");
    res.status(200).send(
      baseScript.replace(/\{\{APP_ORIGIN\}\}/, APP_ORIGIN).replace(
        /[ ]*\/\*\s*EXPERIMENTS\s*\*\//,
        experimentData
          .map((exp) => {
            const options: CompressedExperimentOptions = {
              w: exp.weights,
              u: exp.url || "",
              g: exp.groups,
              f: exp.force ?? -1,
            };
            if (exp.draft) {
              options.d = 1;
            }
            if (exp.anon) {
              options.a = 1;
            }
            if (exp.coverage && options.w) {
              const coverage = exp.coverage;
              options.w = options.w.map((n) => n * coverage);
            }
            return `run(${JSON.stringify(exp.key)},[${exp.variationCode
              .map((v) => `()=>${v}`)
              .join(",")}],${JSON.stringify(options)})`;
          })
          .join("\n")
      )
    );
  } catch (e) {
    console.error(e);
    return res.status(400).send(`console.error(${JSON.stringify(e.message)});`);
  }
}
