import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const _dir = path.dirname(fileURLToPath(import.meta.url));
import { Request, Response } from "express";
import {
  ExperimentInterface,
  LegacyExperimentPhase,
  LegacyVariation,
} from "shared/types/experiment";
import { lookupOrganizationByApiKey } from "back-end/src/models/ApiKeyModel";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { ErrorResponse, ExperimentOverridesResponse } from "back-end/types/api";
import {
  getContextForAgendaJobByOrgId,
  getExperimentOverrides,
} from "back-end/src/services/organizations";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";

export function canAutoAssignExperiment(
  experiment: ExperimentInterface,
): boolean {
  if (!experiment.targetURLRegex) return false;

  return (
    experiment.variations.filter(
      (v: LegacyVariation) =>
        (v.dom && v.dom.length > 0) || (v.css && v.css.length > 0),
    ).length > 0
  );
}

export async function getExperimentConfig(
  req: Request<{ key: string }>,
  res: Response<ExperimentOverridesResponse | ErrorResponse>,
) {
  const { key } = req.params;

  try {
    const { organization, secret } = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res.status(400).json({
        status: 400,
        error: "Invalid API key",
      });
    }
    if (secret) {
      return res.status(400).json({
        status: 400,
        error: "Must use a Publishable API key to get experiment config",
      });
    }

    const context = await getContextForAgendaJobByOrgId(organization);

    const { overrides, expIdMapping } = await getExperimentOverrides(context);

    // TODO: add cache headers?
    res.status(200).json({
      status: 200,
      overrides,
      experiments: expIdMapping,
    });
  } catch (e) {
    req.log.error(e, "Failed to get experiment config");
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
  .readFileSync(path.join(_dir, "..", "templates", "javascript.js"))
  .toString("utf-8")
  .replace(/\/\*\s*eslint-.*\*\//, "")
  .replace(/\n\/\/.*/g, "");

export async function getExperimentsScript(
  req: Request<{ key: string }>,
  res: Response,
) {
  res.setHeader("Content-Type", "text/javascript");
  const { key } = req.params;

  try {
    const { organization, secret } = await lookupOrganizationByApiKey(key);
    if (!organization) {
      return res
        .status(400)
        .send(`console.error("Invalid GrowthBook API key");`);
    }
    if (secret) {
      return res.status(400).json({
        status: 400,
        error:
          "Must use a Publishable API key to load the visual editor script",
      });
    }

    const context = await getContextForAgendaJobByOrgId(organization);
    const experiments = await getAllExperiments(context);

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
      const phaseGroups = (phase as LegacyExperimentPhase)?.groups;
      if (phaseGroups && phaseGroups.length > 0) {
        groups.push(...phaseGroups);
      }

      const data: ExperimentData = {
        key,
        draft: exp.status === "draft",
        anon: exp.userIdType === "anonymous",
        variationCode: exp.variations.map((v: LegacyVariation) => {
          const commands: string[] = [];
          if (v.css) {
            commands.push("injectStyles(" + JSON.stringify(v.css) + ")");
          }
          if (v.dom) {
            v.dom.forEach((dom) => {
              commands.push(
                "mutate.declarative(" + JSON.stringify(dom) + ").revert",
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
          1 / exp.variations.length,
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
          .join("\n"),
      ),
    );
  } catch (e) {
    req.log.error(e, "Failed to get visual editor script");
    return res.status(400).send(`console.error(${JSON.stringify(e.message)});`);
  }
}
