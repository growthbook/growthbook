import { Request, Response } from "express";
import { getExperimentsByOrganization } from "../services/experiments";
import { lookupOrganizationByApiKey } from "../services/apiKey";
import { SegmentModel } from "../models/SegmentModel";
import fs from "fs";
import path from "path";
import { APP_ORIGIN } from "../util/secrets";
import { ExperimentInterface } from "../../types/experiment";

type VariationInfo = {
  key?: string;
  weight?: number;
  data?: {
    [key: string]: unknown;
  };
  dom?: {
    selector: string;
    action: "set" | "append" | "remove";
    attribute: string;
    value: string;
  }[];
  css?: string;
};

type Experiment = {
  key: string;
  status: "draft" | "running" | "stopped";
  anon: boolean;
  auto: boolean;
  variations: number | VariationInfo[];
  force?: number;
  coverage?: number;
  targeting?: string[];
  url?: string;
  // @deprecated
  weights?: number[];
  // @deprecated
  data?: { [key: string]: unknown[] };
};

type ConfigResponse = {
  status: 200;
  experiments: Experiment[];
};

type ErrorResponse = {
  status: 400;
  error: string;
};

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
  res: Response<ConfigResponse | ErrorResponse>
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

    // If experiments are targeted to specific segments
    const segmentIds = new Set<string>();
    experiments.forEach((e) => {
      if (e.segment) {
        segmentIds.add(e.segment);
      }
    });
    const segmentMap = new Map<string, string[]>();
    if (segmentIds.size > 0) {
      const segments = await SegmentModel.find({
        id: { $in: Array.from(segmentIds.values()) },
        organization,
      });
      segments.forEach((s) => {
        if (s.targeting) {
          segmentMap.set(
            s.id,
            s.targeting.split("\n").map((s) => s.trim())
          );
        }
      });
    }

    const list: Experiment[] = [];
    experiments.forEach((exp) => {
      if (exp.archived) {
        return;
      }

      const key = exp.trackingKey || exp.id;
      let data: { [key: string]: unknown[] };
      try {
        data = exp.data?.length > 2 ? JSON.parse(exp.data) : undefined;
      } catch (e) {
        // Bad data
      }
      let targeting = exp.targeting
        ? exp.targeting.split("\n").map((s) => s.trim())
        : [];

      if (exp.segment) {
        targeting = targeting.concat(segmentMap.get(exp.segment) || []);
      }
      const phase = exp.phases[exp.phases.length - 1];
      if (phase && phase.targeting && exp.status === "running") {
        targeting = targeting.concat(
          phase.targeting.split("\n").map((s) => s.trim())
        );
      }
      targeting = targeting.filter((t) => t.length > 0);

      const canAutoAssign = canAutoAssignExperiment(exp);

      const experimentInfo: Experiment = {
        key,
        status: exp.status,
        anon: exp.userIdType !== "user",
        targeting: targeting.length ? targeting : undefined,
        coverage: phase?.coverage,
        auto: (canAutoAssign && exp.autoAssign) || false,
        url: exp.targetURLRegex || undefined,
        variations: exp.variations.map((v, i) => {
          const info: VariationInfo = {};

          if (data) {
            Object.keys(data).forEach((k) => {
              if (data[k]?.[i]) {
                info.data = info.data || {};
                info.data[k] = data[k][i];
              }
            });
          }

          if (v.key) {
            info.key = v.key;
          }
          if (v.css) {
            info.css = v.css;
          }
          if (v.dom && v.dom.length > 0) {
            info.dom = v.dom;
          }
          if (phase && phase.variationWeights) {
            info.weight = phase.variationWeights[i] || 0;
          }

          return info;
        }),
        // TODO: remove once all the SDKs are updated to use the new variationInfos array
        weights: phase?.variationWeights,
        data,
      };

      if (
        JSON.stringify(experimentInfo.variations) ===
        `[${Array(exp.variations.length).fill("{}").join(",")}]`
      ) {
        experimentInfo.variations = exp.variations.length;
      }

      if (exp.status === "stopped" && exp.results === "won") {
        experimentInfo.force = exp.winner;
      }
      if (exp.status === "running") {
        if (!phase) return;
      }

      list.push(experimentInfo);
    });

    // TODO: add cache headers?
    res.status(200).json({
      status: 200,
      experiments: list,
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
