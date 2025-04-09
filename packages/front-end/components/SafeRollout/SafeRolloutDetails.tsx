import { Box, Flex } from "@radix-ui/themes";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import TrafficCard from "../HealthTab/TrafficCard";
import SRMCard from "../HealthTab/SRMCard";
import Callout from "../Radix/Callout";
import { useSnapshot } from "./SnapshotProvider";
import SafeRolloutResults from "./SafeRolloutResults";
import MultipleExposuresCard from "./Health/MultipleExposuresCard";

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
  const { error, snapshot } = useSnapshot();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(safeRollout.datasource);

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
      <div className="container-fluid pagecontents px-0">
        <Box mb="6">
          <SafeRolloutResults safeRollout={safeRollout} />
        </Box>

        {traffic && totalUsers ? (
          <>
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
            <MultipleExposuresCard totalUsers={totalUsers} />
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
