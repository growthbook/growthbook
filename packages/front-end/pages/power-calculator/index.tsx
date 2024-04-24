import { useCallback, useMemo, useState, useEffect } from "react";
import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import PowerCalculationSettingsModal from "@/components/PowerCalculation/PowerCalculationSettingsModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import useOrgSettings from "@/hooks/useOrgSettings";
import PowerCalculationContent from "@/components/PowerCalculation/PowerCalculationContent";

import {
  PowerCalculationParams,
  PowerCalculationResults,
  PartialPowerCalculationParams,
  FullModalPowerCalculationParams,
  StatsEngine,
  config,
} from "@/components/PowerCalculation/types";

import { powerMetricWeeks } from "@/components/PowerCalculation/stats";

const WEEKS = 9;
const INITIAL_FORM_PARAMS = { metrics: {} } as const;
const LOCAL_STORAGE_KEY = "GROWTHBOOK_POWER_CALCULATION";

type PageSettings = {
  powerCalculationParams?: FullModalPowerCalculationParams;
  settingsModalParams: PartialPowerCalculationParams;
  variations: number;
  statsEngine?: StatsEngine;
};

const INITIAL_PAGE_SETTINGS: PageSettings = {
  settingsModalParams: INITIAL_FORM_PARAMS,
  variations: 2,
};

const PowerCalculationPage = (): React.ReactElement => {
  const orgSettings = useOrgSettings();

  const initialJSONParams = localStorage.getItem(LOCAL_STORAGE_KEY);

  const initialParams: PageSettings = initialJSONParams
    ? JSON.parse(initialJSONParams)
    : INITIAL_PAGE_SETTINGS;

  const [showModal, setShowModal] = useState(false);

  const [powerCalculationParams, setProcessedPowerCalculationParams] = useState<
    FullModalPowerCalculationParams | undefined
  >(initialParams.powerCalculationParams);

  const [
    settingsModalParams,
    setSettingsModalParams,
  ] = useState<PartialPowerCalculationParams>(
    initialParams.settingsModalParams
  );

  const [variations, setVariations] = useState(initialParams.variations);

  const [statsEngine, setStatsEngine] = useState<StatsEngine>(
    initialParams.statsEngine || {
      type: "frequentist",
      sequentialTesting: orgSettings.sequentialTestingEnabled
        ? orgSettings.sequentialTestingTuningParameter ||
          DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER
        : false,
    }
  );

  useEffect(() => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        powerCalculationParams,
        settingsModalParams,
        variations,
        statsEngine,
      })
    );
  }, [powerCalculationParams, settingsModalParams, variations, statsEngine]);

  const setPowerCalculationParams = useCallback(
    (p: FullModalPowerCalculationParams | undefined) => {
      if (!p) {
        setProcessedPowerCalculationParams(undefined);
        return;
      }

      setProcessedPowerCalculationParams({
        ...p,
        metrics: Object.keys(p.metrics).reduce(
          (result, key) => ({
            ...result,
            [key]: Object.keys(p.metrics[key]).reduce(
              (metric, entry) => ({
                ...metric,
                [entry]: config[entry]?.isPercent
                  ? p.metrics[key][entry] / 100
                  : p.metrics[key][entry],
              }),
              {}
            ),
          }),
          {}
        ),
      });
    },
    [setProcessedPowerCalculationParams]
  );

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
    <div className="contents power-calculator container-fluid pagecontents">
      {showModal && (
        <PowerCalculationSettingsModal
          close={() => setShowModal(false)}
          onSuccess={(p) => {
            setSettingsModalParams(p);
            setPowerCalculationParams(p);
            setShowModal(false);
          }}
          params={settingsModalParams}
        />
      )}
      {finalParams === undefined && (
        <EmptyPowerCalculation showModal={() => setShowModal(true)} />
      )}
      {results && finalParams && powerCalculationParams && (
        <PowerCalculationContent
          params={finalParams}
          results={results}
          edit={() => {
            setSettingsModalParams(powerCalculationParams);
            setShowModal(true);
          }}
          updateVariations={setVariations}
          updateStatsEngine={setStatsEngine}
          newCalculation={() => {
            setSettingsModalParams(INITIAL_FORM_PARAMS);
            setShowModal(true);
          }}
        />
      )}
    </div>
  );
};

export default PowerCalculationPage;
