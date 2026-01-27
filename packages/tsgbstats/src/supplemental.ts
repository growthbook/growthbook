import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "./models/settings";
import type {
  DimensionMetricData,
  DimensionResponse,
  SupplementalResults,
  VariationResponse,
  BayesianVariationResponse,
  FrequentistVariationResponse,
  BaselineResponseWithSupplementalResults,
  BayesianVariationResponseIndividual,
  FrequentistVariationResponseIndividual,
  BaselineResponse,
} from "./gbstats";
import { analyzeMetricDf } from "./gbstats";
import { testPostStratEligible } from "./utils/postStratEligible";
import { replaceWithUncapped } from "./utils/uncapped";

interface DimensionResponseIndividual {
  dimension: string;
  srm: number;
  variations: (
    | BaselineResponse
    | BayesianVariationResponseIndividual
    | FrequentistVariationResponseIndividual
  )[];
}

/**
 * Extended metric settings that includes optional uncapped metric computation flag.
 */
interface MetricSettingsWithUncapped extends MetricSettingsForStatsEngine {
  computeUncappedMetric?: boolean;
}

/**
 * Create core analysis results along with supplemental alternative analyses.
 * Mirrors Python's create_core_and_supplemental_results function.
 */
export function createCoreAndSupplementalResults(
  reducedMetricData: DimensionMetricData[],
  numVariations: number,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): DimensionResponse[] {
  // Run the core analysis
  const coreResult = analyzeMetricDf(
    reducedMetricData,
    numVariations,
    metric,
    analysis,
  ) as DimensionResponseIndividual[];

  // Determine which supplemental analyses to run
  const cupedAdjusted =
    metric.statisticType === "ratio_ra" || metric.statisticType === "mean_ra";
  // computeUncappedMetric is an optional extension to the metric settings
  const computeUncapped =
    "computeUncappedMetric" in metric &&
    (metric as MetricSettingsWithUncapped).computeUncappedMetric;
  const analysisBayesian =
    analysis.statsEngine === "bayesian" && metric.priorProper;
  const postStratify = testPostStratEligible(metric, analysis);

  let resultCupedUnadjusted: DimensionResponseIndividual[] | null = null;
  let resultUncapped: DimensionResponseIndividual[] | null = null;
  let resultFlatPrior: DimensionResponseIndividual[] | null = null;
  let resultUnstratified: DimensionResponseIndividual[] | null = null;
  let resultNoVarianceReduction: DimensionResponseIndividual[] | null = null;

  // CUPED unadjusted (for mean_ra and ratio_ra)
  if (cupedAdjusted) {
    const metricCupedUnadjusted: MetricSettingsForStatsEngine = {
      ...metric,
      statisticType: metric.statisticType === "mean_ra" ? "mean" : "ratio",
    };
    resultCupedUnadjusted = analyzeMetricDf(
      reducedMetricData,
      numVariations,
      metricCupedUnadjusted,
      analysis,
    ) as DimensionResponseIndividual[];

    if (postStratify) {
      const analysisUnstratified: AnalysisSettingsForStatsEngine = {
        ...analysis,
        postStratificationEnabled: false,
      };
      resultUnstratified = analyzeMetricDf(
        reducedMetricData,
        numVariations,
        metric,
        analysisUnstratified,
      ) as DimensionResponseIndividual[];
      resultNoVarianceReduction = analyzeMetricDf(
        reducedMetricData,
        numVariations,
        metricCupedUnadjusted,
        analysisUnstratified,
      ) as DimensionResponseIndividual[];
    }
  } else if (postStratify) {
    const analysisUnstratified: AnalysisSettingsForStatsEngine = {
      ...analysis,
      postStratificationEnabled: false,
    };
    resultUnstratified = analyzeMetricDf(
      reducedMetricData,
      numVariations,
      metric,
      analysisUnstratified,
    ) as DimensionResponseIndividual[];
  }

  // Uncapped (if metric has uncapped columns)
  if (computeUncapped) {
    const uncappedMetricData: DimensionMetricData[] = reducedMetricData.map(
      (d) => ({
        ...d,
        data: replaceWithUncapped(d.data),
      }),
    );
    resultUncapped = analyzeMetricDf(
      uncappedMetricData,
      numVariations,
      metric,
      analysis,
    ) as DimensionResponseIndividual[];
  }

  // Flat prior (for Bayesian with proper prior)
  if (analysisBayesian) {
    const metricFlatPrior: MetricSettingsForStatsEngine = {
      ...metric,
      priorProper: false,
    };
    resultFlatPrior = analyzeMetricDf(
      reducedMetricData,
      numVariations,
      metricFlatPrior,
      analysis,
    ) as DimensionResponseIndividual[];
  }

  // Combine core and supplemental results
  return combineResults(
    coreResult,
    resultCupedUnadjusted,
    resultUncapped,
    resultFlatPrior,
    resultUnstratified,
    resultNoVarianceReduction,
  );
}

function combineResults(
  coreResult: DimensionResponseIndividual[],
  resultCupedUnadjusted: DimensionResponseIndividual[] | null,
  resultUncapped: DimensionResponseIndividual[] | null,
  resultFlatPrior: DimensionResponseIndividual[] | null,
  resultUnstratified: DimensionResponseIndividual[] | null,
  resultNoVarianceReduction: DimensionResponseIndividual[] | null,
): DimensionResponse[] {
  const supplementalMappings: Array<
    [DimensionResponseIndividual[] | null, keyof SupplementalResults]
  > = [
    [resultCupedUnadjusted, "cupedUnadjusted"],
    [resultUncapped, "uncapped"],
    [resultFlatPrior, "flatPrior"],
    [resultUnstratified, "unstratified"],
    [resultNoVarianceReduction, "noVarianceReduction"],
  ];

  // Check if any supplemental results exist
  const hasAnySupplemental = supplementalMappings.some(
    ([result]) => result !== null,
  );

  const result: DimensionResponse[] = [];

  for (let dimI = 0; dimI < coreResult.length; dimI++) {
    const dimResult = coreResult[dimI];
    const variations: VariationResponse[] = [];

    for (let varI = 0; varI < dimResult.variations.length; varI++) {
      const variation = dimResult.variations[varI];
      const isBayesian = "chanceToWin" in variation;
      const isFrequentist = "pValue" in variation;

      // If no supplemental results needed, just use core variation as-is
      if (!hasAnySupplemental) {
        variations.push(variation as VariationResponse);
        continue;
      }

      // Create supplemental results object
      const supplementalResults: SupplementalResults = {
        cupedUnadjusted: null,
        uncapped: null,
        flatPrior: null,
        unstratified: null,
        noVarianceReduction: null,
      };

      // Set supplemental results if available
      for (const [supplementalResult, attributeName] of supplementalMappings) {
        if (
          supplementalResult !== null &&
          supplementalResult.length > dimI &&
          supplementalResult[dimI].variations.length > varI &&
          supplementalResult[dimI].variations[varI] !== null
        ) {
          supplementalResults[attributeName] =
            supplementalResult[dimI].variations[varI];
        }
      }

      // Create the variation response with supplemental
      let variationResponse: VariationResponse;
      if (isBayesian) {
        variationResponse = {
          ...variation,
          supplementalResults,
        } as BayesianVariationResponse;
      } else if (isFrequentist) {
        variationResponse = {
          ...variation,
          supplementalResults,
        } as FrequentistVariationResponse;
      } else {
        variationResponse = {
          ...variation,
          supplementalResults,
        } as BaselineResponseWithSupplementalResults;
      }

      variations.push(variationResponse);
    }

    result.push({
      dimension: dimResult.dimension,
      srm: dimResult.srm,
      variations,
    });
  }

  return result;
}
