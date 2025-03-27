import { Box, Heading, Text } from "@radix-ui/themes";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ExperimentData } from "@/hooks/useExperimentStatusIndicator";
import ExperimentStatusIndicator from "../Experiment/TabbedPage/ExperimentStatusIndicator";
import TrafficCard from "../HealthTab/TrafficCard";
import SRMCard from "../HealthTab/SRMCard";
import Callout from "../Radix/Callout";
import SafeRolloutSummary from "../Features/SafeRolloutSummary";
import Frame from "../Radix/Frame";
import { useSnapshot } from "./SnapshotProvider";
import SafeRolloutResults from "./SafeRolloutResults";

interface Props {
  safeRollout: SafeRolloutRule;
  feature: FeatureInterface;
}

const variations = [
  {
    id: "0",
    name: "Control",
    weight: 0.5,
  },
  {
    id: "1",
    name: "Variation",
    weight: 0.5,
  },
];

export default function SafeRolloutDetails({ safeRollout, feature }: Props) {
  const { error, snapshot, mutateSnapshot } = useSnapshot();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(safeRollout.datasource);

  const {
    value,
    coverage,
    hashAttribute,
    guardrailMetrics,
    controlValue,
  } = safeRollout;
  console.log({ snapshot });

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === safeRollout.exposureQueryId
  );

  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0
  );
  const traffic = snapshot?.health?.traffic;

  return (
    <div>
      <div className="container-fluid pagecontents position-relative experiment-header px-3 pt-3"></div>

      <div className="container-fluid pagecontents">
        <div className="d-flex align-items-center mb-3 mt-3">
          <Flex direction="row" align="center">
            <h1 className="mb-0">Safe Rollout</h1>
            <Box ml="2">
              {/* <ExperimentStatusIndicator
                experimentData={safeRollout as ExperimentData}
              /> */}
            </Box>
          </Flex>
        </div>
        <h2>Overview</h2>
        <Frame>
          <div className="mb-3">
            <strong className="font-weight-semibold h4">
              Targeting & Sampling
            </strong>
          </div>
          <SafeRolloutSummary
            value={value}
            coverage={coverage}
            feature={feature}
            hashAttribute={hashAttribute}
            guardrailMetrics={guardrailMetrics}
            controlValue={controlValue}
          />
        </Frame>

        <h2>Results</h2>
        <Frame>
          <SafeRolloutResults safeRollout={safeRollout} />
        </Frame>
        {traffic && totalUsers ? (
          <>
            <TrafficCard
              traffic={traffic}
              variations={variations}
              isBandit={false}
            />
            <h2>Health</h2>
            <SRMCard
              traffic={traffic}
              variations={variations}
              totalUsers={totalUsers}
              onNotify={() => {}}
              dataSource={datasource}
              exposureQuery={exposureQuery}
              canConfigHealthTab={false}
            />
          </>
        ) : (
          <Callout status="info" mt="3">
            Please run a query to see health data.
          </Callout>
        )}
      </div>
    </div>
  );
}
