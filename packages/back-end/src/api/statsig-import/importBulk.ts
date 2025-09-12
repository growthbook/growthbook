import { AuthRequest } from "back-end/src/types/AuthRequest";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { z } from "zod";
import { createFeature } from "back-end/src/models/FeatureModel";
import { createExperiment } from "back-end/src/models/ExperimentModel";
import { insertMetric } from "back-end/src/models/MetricModel";
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
} from "back-end/src/statsig-converters/statsig-converters";

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
  }),
});


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


export const importStatsigBulk = createApiRequestHandler(
  {
    bodySchema: importBulkValidator,
  }
)(async (
  req
): Promise<ImportBulkResponse> => {
  const { 
    featureGates = [], 
    dynamicConfigs = [], 
    layers = [], 
    experiments = [], 
    segments = [], 
    metrics = [],
    projectId,
    datasourceId = "default"
  } = req.body as any;
  const { org } = req.context;

  const results = {
    featureGates: [] as ImportResult[],
    dynamicConfigs: [] as ImportResult[],
    layers: [] as ImportResult[],
    experiments: [] as ImportResult[],
    segments: [] as ImportResult[],
    metrics: [] as ImportResult[],
  };

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
        org.id,
        projectId
      );

      if (!conversionResult.success || !conversionResult.data) {
        results.featureGates.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      await createFeature(req.context, conversionResult.data as any);
      results.featureGates.push({
        success: true,
        id: conversionResult.data.id,
      });
    } catch (error) {
      results.featureGates.push({
        success: false,
        error: error.message || "Failed to import feature gate",
      });
    }
  }

  // // Import dynamic configs
  // for (const configData of dynamicConfigs) {
  //   try {
  //     const validationResult = validateStatsigDynamicConfigData(configData);
  //     if (!validationResult.success) {
  //       results.dynamicConfigs.push({
  //         success: false,
  //         error: validationResult.error,
  //       });
  //       continue;
  //     }

  //     const conversionResult = convertStatsigDynamicConfig(
  //       configData as StatsigDynamicConfigData,
  //       org.id,
  //       projectId
  //     );

  //     if (!conversionResult.success || !conversionResult.data) {
  //       results.dynamicConfigs.push({
  //         success: false,
  //         error: conversionResult.error,
  //       });
  //       continue;
  //     }

  //     await createFeature(req.context, conversionResult.data as any);
  //     results.dynamicConfigs.push({
  //       success: true,
  //       id: conversionResult.data.id,
  //     });
  //   } catch (error) {
  //     results.dynamicConfigs.push({
  //       success: false,
  //       error: error.message || "Failed to import dynamic config",
  //     });
  //   }
  // }

  // // Import layers
  // for (const layerData of layers) {
  //   try {
  //     const validationResult = validateStatsigLayerData(layerData);
  //     if (!validationResult.success) {
  //       results.layers.push({
  //         success: false,
  //         error: validationResult.error,
  //       });
  //       continue;
  //     }

  //     const conversionResult = convertStatsigLayer(
  //       layerData as StatsigLayerData,
  //       org.id,
  //       projectId
  //     );

  //     if (!conversionResult.success || !conversionResult.data) {
  //       results.layers.push({
  //         success: false,
  //         error: conversionResult.error,
  //       });
  //       continue;
  //     }

  //     await createFeature(req.context, conversionResult.data as any);
  //     results.layers.push({
  //       success: true,
  //       id: conversionResult.data.id,
  //     });
  //   } catch (error) {
  //     results.layers.push({
  //       success: false,
  //       error: error.message || "Failed to import layer",
  //     });
  //   }
  // }

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
        org.id,
        projectId
      );

      if (!conversionResult.success || !conversionResult.data) {
        results.experiments.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }

      const createdExperiment = await createExperiment({
        context: req.context,
        data: conversionResult.data as any,
      });
      results.experiments.push({
        success: true,
        id: createdExperiment.id,
      });
    } catch (error) {
      results.experiments.push({
        success: false,
        error: error.message || "Failed to import experiment",
      });
    }
  }

  // // Import segments
  // for (const segmentData of segments) {
  //   try {
  //     const validationResult = validateStatsigSegmentData(segmentData);
  //     if (!validationResult.success) {
  //       results.segments.push({
  //         success: false,
  //         error: validationResult.error,
  //       });
  //       continue;
  //     }

  //     const conversionResult = convertStatsigSegment(
  //       segmentData as StatsigSegmentData,
  //       org.id,
  //       datasourceId,
  //       projectId
  //     );

  //     if (!conversionResult.success || !conversionResult.data) {
  //       results.segments.push({
  //         success: false,
  //         error: conversionResult.error,
  //       });
  //       continue;
  //     }

  //     const createdSegment = await req.context.models.segments.create(conversionResult.data as any);
  //     results.segments.push({
  //       success: true,
  //       id: createdSegment.id,
  //     });
  //   } catch (error) {
  //     results.segments.push({
  //       success: false,
  //       error: error.message || "Failed to import segment",
  //     });
  //   }
  // }

  // Import metrics
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
        org.id,
        datasourceId,
        projectId
      );

      if (!conversionResult.success || !conversionResult.data) {
        results.metrics.push({
          success: false,
          error: conversionResult.error,
        });
        continue;
      }
      // TODO: Add metric import to Fact metrics
      // const createdMetric = await insertMetric(conversionResult.data as any);
      // results.metrics.push({
      //   success: true,
      //   id: createdMetric.id,
      // });
    } catch (error) {
      results.metrics.push({
        success: false,
        error: error.message || "Failed to import metric",
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

  return {
    status: 200,
    results,
    summary,
  };
});
