import { useMemo, useState } from "react";
import PowerCalculationModal from "@/components/PowerCalculation/PowerCalculationModal";
import EmptyPowerCalculation from "@/components/PowerCalculation/EmptyPowerCalculation";
import {
  PowerCalculationParams,
  PowerCalculationResults,
} from "@/components/PowerCalculation/types";

const dummyResultsData: PowerCalculationResults[string] = {
  sampleSizeAndRuntime: {
    effect: 32.34,
    days: 10,
    users: 12245,
    type: "mean",
  },
  minimumDetectableEffectOverTime: {
    type: "mean",
    weeks: [
      {
        users: 12245,
        effect: 32.34,
      },
      {
        users: 12245,
        effect: 32.34,
      },
      {
        users: 12245,
        effect: 32.34,
      },
      {
        users: 12245,
        effect: 32.34,
      },
      {
        users: 12245,
        effect: 32.34,
      },
      {
        users: 12245,
        effect: 32.34,
      },
      {
        users: 12245,
        effect: 32.34,
      },
    ],
  },
  powerOverTime: {
    type: "mean",
    weeks: [
      {
        users: 12245,
        power: 32.34,
      },
      {
        users: 12245,
        power: 32.34,
      },
      {
        users: 12245,
        power: 32.34,
      },
      {
        users: 12245,
        power: 32.34,
      },
      {
        users: 12245,
        power: 32.34,
      },
      {
        users: 12245,
        power: 32.34,
      },
      {
        users: 12245,
        power: 32.34,
      },
    ],
  },
};

const PowerCalculationPage = (): React.ReactElement => {
  const [showModal, setShowModal] = useState(false);
  const [powerCalculationParams, setPowerCalculationParams] = useState<
    PowerCalculationParams | undefined
  >();

  const results: PowerCalculationResults | undefined = useMemo(() => {
    if (!powerCalculationParams) return;

    return Object.values(
      powerCalculationParams.metrics
    ).reduce<PowerCalculationResults>(
      (results, { name }) => ({
        ...results,
        [name]: dummyResultsData,
      }),
      { "Total Revenue": dummyResultsData }
    );
  }, [powerCalculationParams]);

  return (
    <>
      {showModal && (
        <PowerCalculationModal
          close={() => setShowModal(false)}
          onSuccess={(p) => {
            setPowerCalculationParams(p);
            setShowModal(false);
          }}
        />
      )}
      {powerCalculationParams === undefined && (
        <EmptyPowerCalculation setShowModal={setShowModal} />
      )}
      {results && JSON.stringify(results, null, 2)}
    </>
  );
};

export default PowerCalculationPage;
