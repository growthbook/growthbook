import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { FeatureInterface } from "back-end/src/validators/features";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { ago, getValidDate } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/components/Radix/Link";
import MultipleExposuresCard from "@/components/HealthTab/MultipleExposuresCard";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import SRMCard from "../HealthTab/SRMCard";
import Callout from "../Radix/Callout";
import { getQueryStatus } from "../Queries/RunQueriesButton";
import SafeRolloutResults from "./SafeRolloutResults";
import RefreshSnapshotButton from "./RefreshSnapshotButton";

interface Props {
  safeRollout: SafeRolloutInterface;
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

export default function SafeRolloutDetails({ safeRollout }: Props) {
  const {
    snapshot,
    loading: snapshotLoading,
    latest,
    analysis,
    mutateSnapshot,
  } = useSafeRolloutSnapshot();
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(safeRollout.datasourceId);

  const { status: queryStatus } = getQueryStatus(
    latest?.queries || [],
    latest?.error
  );
  const safeRolloutAgeMinutes =
    (Date.now() - getValidDate(safeRollout.startedAt ?? "").getTime()) /
    (1000 * 60);
  const hasData = (analysis?.results?.[0]?.variations?.length ?? 0) > 0;

  const exposureQuery = datasource?.settings.queries?.exposure?.find(
    (e) => e.id === safeRollout.exposureQueryId
  );

  const totalUsers = snapshot?.health?.traffic?.overall?.variationUnits?.reduce(
    (acc, a) => acc + a,
    0
  );

  const traffic = snapshot?.health?.traffic;
  const [isHealthExpanded, setIsHealthExpanded] = useState(false);

  if (
    !hasData &&
    queryStatus !== "running" &&
    !snapshotLoading &&
    safeRolloutAgeMinutes < 120
  ) {
    return (
      <Callout status="info" my="4">
        <span className="mr-auto">
          {"Started " +
            ago(safeRollout.startedAt ?? "") +
            ". Give it a little longer and check again."}
        </span>
        <RefreshSnapshotButton
          mutate={() => {
            mutateSnapshot();
          }}
          safeRollout={safeRollout}
        />
        {snapshotLoading && <div> Snapshot loading...</div>}
      </Callout>
    );
  }

  return (
    <div>
      <div className="container-fluid pagecontents px-0">
        <Box mb="6">
          <SafeRolloutResults safeRollout={safeRollout} />
        </Box>

        {traffic && totalUsers ? (
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
                />
                <MultipleExposuresCard
                  totalUsers={totalUsers}
                  snapshot={snapshot}
                  onNotify={() => {}}
                />
              </>
            ) : null}
          </>
        ) : snapshot ? (
          <Callout status="info" mt="3">
            Please run a query to see health data.
          </Callout>
        ) : null}
      </div>
    </div>
  );
}
