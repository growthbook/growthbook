import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/components/Radix/Link";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import SRMCard from "../HealthTab/SRMCard";
import Callout from "../Radix/Callout";
import SafeRolloutResults from "./SafeRolloutResults";

interface Props {
  safeRollout: SafeRolloutInterface;
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

export default function SafeRolloutDetails({ safeRollout }: Props) {
  const { snapshot } = useSafeRolloutSnapshot();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(safeRollout.datasourceId);

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === safeRollout.exposureQueryId
  );

  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0
  );

  const traffic = snapshot?.health?.traffic;
  const [isHealthExpanded, setIsHealthExpanded] = useState(false);

  return (
    <div>
      <div className="container-fluid pagecontents px-0">
        <Box mb="6">
          <SafeRolloutResults safeRollout={safeRollout} />
        </Box>

        {snapshot && (
          <>
            <Flex align="center" justify="between" mb="3">
              <Text weight="medium" size="3">
                Health
              </Text>
              <Link
                weight="medium"
                onClick={() => setIsHealthExpanded(!isHealthExpanded)}
              >
                Show {isHealthExpanded ? "less" : "more"}
              </Link>
            </Flex>
            {isHealthExpanded ? (
              traffic && totalUsers ? (
                <>
                  <SRMCard
                    newDesign={true}
                    traffic={traffic}
                    variations={variations}
                    totalUsers={totalUsers}
                    onNotify={() => {}}
                    dataSource={datasource}
                    exposureQuery={exposureQuery}
                    canConfigHealthTab={false}
                    hideDimensions
                  />
                  <MultipleExposuresCard
                    totalUsers={totalUsers}
                    snapshot={snapshot}
                    onNotify={() => {}}
                  />
                </>
              ) : (
                <Callout status="info" mt="3">
                  Please run a query to see health data.
                </Callout>
              )
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
