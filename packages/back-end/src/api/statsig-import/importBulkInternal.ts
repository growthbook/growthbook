import { Request, Response } from "express";
import { z } from "zod";
import { createFeature } from "back-end/src/models/FeatureModel";
import { createExperiment } from "back-end/src/models/ExperimentModel";
import { insertMetric } from "back-end/src/models/MetricModel";
import { SegmentModel } from "back-end/src/models/SegmentModel";
import { 
  convertStatsigFeatureGate, 
  validateStatsigFeatureGateData,
  convertStatsigDynamicConfig, 
  validateStatsigDynamicConfigData,
  convertStatsigLayer, 
  validateStatsigLayerData,
  convertStatsigExperiment, 
  validateStatsigExperimentData,
  convertStatsigMetric, 
  validateStatsigMetricData,
  convertStatsigSegment, 
  validateStatsigSegmentData,
  type StatsigFeatureGateData,
  type StatsigDynamicConfigData,
  type StatsigLayerData,
  type StatsigExperimentData,
  type StatsigMetricData,
  type StatsigSegmentData,
} from "back-end/src/validators/statsig-converters";

const importBulkValidator = z.object({
  body: z.object({
    featureGates: z.array(z.any()).optional(),
    dynamicConfigs: z.array(z.any()).optional(),
    layers: z.array(z.any()).optional(),
    experiments: z.array(z.any()).optional(),
    segments: z.array(z.any()).optional(),
    metrics: z.array(z.any()).optional(),
    projectId: z.string().optional(),
    datasourceId: z.string().optional(),
    orgId: z.string(), // Required for internal API
  }),
});

type ImportBulkRequest = Request<
  z.infer<typeof importBulkValidator>["body"],
  unknown,
  unknown
>;

type ImportResult = {
  success: boolean;
  id?: string;
  error?: string;
};

type ImportBulkResponse = {
  status: 200;
  results: {
    featureGates: ImportResult[];
    dynamicConfigs: ImportResult[];
    layers: ImportResult[];
    experiments: ImportResult[];
    segments: ImportResult[];
    metrics: ImportResult[];
  };
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
};

export const importStatsigBulkInternal = async (
  req: ImportBulkRequest,
  res: Response<ImportBulkResponse>
): Promise<ImportBulkResponse> => {
  const body = req.body as any;
  const { 
    featureGates = [], 
    dynamicConfigs = [], 
    layers = [], 
    experiments = [], 
    segments = [], 
    metrics = [],
    projectId,
    datasourceId = "default",
    orgId
  } = body;

  // Create a minimal context for internal API
  const context = {
    org: { id: orgId },
    user: { id: "internal" },
    req: req,
    res: res,
  };

  const results = {
    featureGates: [] as ImportResult[],
    dynamicConfigs: [] as ImportResult[],
    layers: [] as ImportResult[],
    experiments: [] as ImportResult[],
    segments: [] as ImportResult[],
    metrics: [] as ImportResult[],
  };

  // Import metrics first (required for experiments and other entities)
  for (const metricData of metrics) {
    try {
      const validationResult = validateStatsigMetricData(metricData);
      if (!validationResult.success) {
        results.metrics.push({
          success: false,
          error: validationResult.error,
        });
        continue;
      }

      const conversionResult = convertStatsigMetric(
        metricData as StatsigMetricData,
        orgId,
        datasourceId,
        projectId
      );

      if (!conversionResult.success) {
        results.metrics.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdMetric = await insertMetric(conversionResult.data);
      results.metrics.push({
        success: true,
        metric: createdMetric,
      });
    } catch (error) {
      results.metrics.push({
        success: false,
        error: error.message || "Failed to import metric",
      });
    }
  }

  // Import segments (required for experiments)
  for (const segmentData of segments) {
    try {
      const validationResult = validateStatsigSegmentData(segmentData);
      if (!validationResult.success) {
        results.segments.push({
          success: false,
          error: validationResult.error,
        });
        continue;
      }

      const conversionResult = convertStatsigSegment(
        segmentData as StatsigSegmentData,
        orgId,
        datasourceId,
        projectId
      );

      if (!conversionResult.success) {
        results.segments.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdSegment = await SegmentModel.create(context, conversionResult.data);
      results.segments.push({
        success: true,
        segment: createdSegment,
      });
    } catch (error) {
      results.segments.push({
        success: false,
        error: error.message || "Failed to import segment",
      });
    }
  }

  // Import feature gates
  for (const gateData of featureGates) {
    try {
      const validationResult = validateStatsigFeatureGateData(gateData);
      if (!validationResult.success) {
        results.featureGates.push({
          success: false,
          error: validationResult.error,
        });
        continue;
      }

      const conversionResult = convertStatsigFeatureGate(
        gateData as StatsigFeatureGateData,
        orgId,
        projectId
      );

      if (!conversionResult.success) {
        results.featureGates.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdFeature = await createFeature(context, conversionResult.data);
      results.featureGates.push({
        success: true,
        featureGate: createdFeature,
      });
    } catch (error) {
      results.featureGates.push({
        success: false,
        error: error.message || "Failed to import feature gate",
      });
    }
  }

  // Import dynamic configs
  for (const configData of dynamicConfigs) {
    try {
      const validationResult = validateStatsigDynamicConfigData(configData);
      if (!validationResult.success) {
        results.dynamicConfigs.push({
          success: false,
          error: validationResult.error,
        });
        continue;
      }

      const conversionResult = convertStatsigDynamicConfig(
        configData as StatsigDynamicConfigData,
        orgId,
        projectId
      );

      if (!conversionResult.success) {
        results.dynamicConfigs.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdFeature = await createFeature(context, conversionResult.data);
      results.dynamicConfigs.push({
        success: true,
        dynamicConfig: createdFeature,
      });
    } catch (error) {
      results.dynamicConfigs.push({
        success: false,
        error: error.message || "Failed to import dynamic config",
      });
    }
  }

  // Import layers
  for (const layerData of layers) {
    try {
      const validationResult = validateStatsigLayerData(layerData);
      if (!validationResult.success) {
        results.layers.push({
          success: false,
          error: validationResult.error,
        });
        continue;
      }

      const conversionResult = convertStatsigLayer(
        layerData as StatsigLayerData,
        orgId,
        projectId
      );

      if (!conversionResult.success) {
        results.layers.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdFeature = await createFeature(context, conversionResult.data);
      results.layers.push({
        success: true,
        layer: createdFeature,
      });
    } catch (error) {
      results.layers.push({
        success: false,
        error: error.message || "Failed to import layer",
      });
    }
  }

  // Import experiments
  for (const expData of experiments) {
    try {
      const validationResult = validateStatsigExperimentData(expData);
      if (!validationResult.success) {
        results.experiments.push({
          success: false,
          error: validationResult.error,
        });
        continue;
      }

      const conversionResult = convertStatsigExperiment(
        expData as StatsigExperimentData,
        orgId,
        projectId
      );

      if (!conversionResult.success) {
        results.experiments.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdExperiment = await createExperiment({
        context: context,
        data: conversionResult.data,
      });
      results.experiments.push({
        success: true,
        experiment: createdExperiment,
      });
    } catch (error) {
      results.experiments.push({
        success: false,
        error: error.message || "Failed to import experiment",
      });
    }
  }


  // Calculate summary
  const allResults = [
    ...results.featureGates,
    ...results.dynamicConfigs,
    ...results.layers,
    ...results.experiments,
    ...results.segments,
    ...results.metrics,
  ];

  const summary = {
    total: allResults.length,
    successful: allResults.filter(r => r.success).length,
    failed: allResults.filter(r => !r.success).length,
  };

  return res.status(200).json({
    status: 200,
    results,
    summary,
  });
};
