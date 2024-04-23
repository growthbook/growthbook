import { useMemo, useState } from "react";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import PowerCalculationSettingsModal from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import useOrgSettings from "@/hooks/useOrgSettings";
import PowerCalculationContent from "@/components/PowerCalculation/PowerCalculationContent";

import {
  PowerCalculationParams,
  PowerCalculationResults,
  FullModalPowerCalculationParams,
  StatsEngine,
} from "@/components/PowerCalculation/types";

import { powerMetricWeeks } from "@/components/PowerCalculation/stats";

const WEEKS = 9;

const PowerCalculationPage = (): React.ReactElement => {
  const [showModal, setShowModal] = useState(false);

  const [powerCalculationParams, setPowerCalculationParams] = useState<
    FullModalPowerCalculationParams | undefined
  >();

  const [variations, setVariations] = useState(2);

  const orgSettings = useOrgSettings();

  const [statsEngine, setStatsEngine] = useState<StatsEngine>({
    type: "frequentist",
    sequentialTesting: orgSettings.sequentialTestingEnabled
      ? orgSettings.sequentialTestingTuningParameter ||
        DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
      : false,
  });

  const finalParams: PowerCalculationParams | undefined = useMemo(() => {
    if (!powerCalculationParams) return;

    return {
      ...powerCalculationParams,
      statsEngine,
      nVariations: variations,
      nWeeks: WEEKS,
      targetPower: 0.8,
      alpha: 0.05,
    };
  }, [powerCalculationParams, variations, statsEngine]);

  const results: PowerCalculationResults | undefined = useMemo(() => {
    if (!finalParams) return;

    return powerMetricWeeks(finalParams);
  }, [finalParams]);

  return (
    <>
      {showModal && (
        <PowerCalculationSettingsModal
          close={() => setShowModal(false)}
          onSuccess={(p) => {
            setPowerCalculationParams(p);
            setShowModal(false);
          }}
        />
      )}
      {finalParams === undefined && (
        <EmptyPowerCalculation showModal={() => setShowModal(true)} />
      )}
      {results && finalParams && (
        <PowerCalculationContent
          params={finalParams}
          results={results}
          clear={() => setPowerCalculationParams(undefined)}
          updateVariations={setVariations}
          updateStatsEngine={setStatsEngine}
          showModal={() => {
            setPowerCalculationParams(undefined);
            setShowModal(true);
          }}
        />
      )}
    </>
  );
};

export default PowerCalculationPage;
