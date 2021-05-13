import { Request, Response } from "express";
import { getExperimentsByOrganization } from "../services/experiments";
import { lookupOrganizationByApiKey } from "../services/apiKey";
import fs from "fs";
import path from "path";
import { APP_ORIGIN } from "../util/secrets";
import { ExperimentInterface } from "../../types/experiment";
import {
  ErrorResponse,
  ExperimentOverride,
  ExperimentOverridesResponse,
} from "../../types/api";

export function canAutoAssignExperiment(
  experiment: ExperimentInterface
): boolean {
  if (!experiment.targetURLRegex) return false;

  return (
    experiment.variations.filter((v) => v.dom?.length > 0 || v.css?.length > 0)
      .length > 0
  );
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
    const experiments = await getExperimentsByOrganization(organization);
    const overrides: Record<string, ExperimentOverride> = {};

    experiments.forEach((exp) => {
      if (exp.archived) {
        return;
      }

      const key = exp.trackingKey || exp.id;
      const groups: string[] = [];

      const phase = exp.phases[exp.phases.length - 1];
      if (phase && exp.status === "running" && phase.groups?.length > 0) {
        groups.push(...phase.groups);
      }

      const override: ExperimentOverride = {
        status: exp.status,
      };

      if (exp.targetURLRegex) {
        override.url = exp.targetURLRegex;
      }

      if (groups.length) {
        override.groups = groups;
      }

      if (phase) {
        override.coverage = phase.coverage;
        override.weights = phase.variationWeights;
      }

      if (exp.status === "stopped" && exp.results === "won") {
        override.force = exp.winner;
      }

      if (exp.status === "running") {
        if (!phase) return;
      }

      overrides[key] = override;
    });

    // TODO: add cache headers?
    res.status(200).json({
      status: 200,
      overrides,
    });
  } catch (e) {
    console.error(e);
    res.status(400).json({
      status: 400,
      error: "Failed to get experiment config",
    });
  }
}

let visualDesignerContents: string;
export async function getVisualDesignerScript(req: Request, res: Response) {
  if (!visualDesignerContents) {
    const visualDesignerPath = path.join(
      __dirname,
      "..",
      "..",
      "node_modules",
      "ab-designer",
      "dist",
      "ab-designer.cjs.production.min.js"
    );
    visualDesignerContents = fs.existsSync(visualDesignerPath)
      ? fs.readFileSync(visualDesignerPath).toString()
      : "";
    visualDesignerContents = visualDesignerContents
      .replace(/\/\/# sourceMappingURL.*/, "")
      .replace(/"use strict";/, "");
    visualDesignerContents = `function startVisualDesigner(){${visualDesignerContents}}
if(window.location.search.match(/\\bgrowthbookVisualDesigner\\b/)) {
  window.growthbook=window.growthbook||[];window.growthbook.push("disable");
  window.EXP_PLATFORM_ORIGIN="${APP_ORIGIN}";
  startVisualDesigner();
}`;
  }

  res.setHeader("Content-Type", "text/javascript");
  res.send(visualDesignerContents);
}
