import { FC } from "react";
import {
  ContextualBanditEventInterface,
  ContextualBanditSnapshotInterface,
  LeafWeight,
} from "shared/validators";
import { date } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Text from "@/ui/Text";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import LoadingSpinner from "@/components/LoadingSpinner";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

type CurrentResponse = {
  currentLeafWeights: LeafWeight[];
  latestEvent: ContextualBanditEventInterface | null;
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function getConditionLabel(leaf: LeafWeight) {
  if (leaf.contextId === "other") return "Other";
  if (!Object.keys(leaf.condition).length) return "All users";
  return JSON.stringify(leaf.condition);
}

function getBestArmProbabilities(
  leaf: LeafWeight,
  latestEvent: ContextualBanditEventInterface | null,
) {
  const result = latestEvent?.contextResults.find(
    (context) => context.contextId === leaf.contextId,
  );
  if (!result) return "Not available";
  const posteriorMeans = result.variations.map((variation) =>
    variation.posteriorMean === undefined
      ? "n/a"
      : variation.posteriorMean.toFixed(3),
  );
  return posteriorMeans.join(" / ");
}

export const ContextualBanditResultsTab: FC<{
  experiment: ExperimentInterfaceStringDates;
}> = ({ experiment }) => {
  const { apiCall } = useAuth();
  const current = useApi<CurrentResponse>(
    `/experiment/${experiment.id}/contextual-bandit/current`,
  );
  const snapshots = useApi<{ snapshots: ContextualBanditSnapshotInterface[] }>(
    `/experiment/${experiment.id}/contextual-bandit/snapshots?limit=10`,
    { refreshInterval: 5000 },
  );
  const latestSnapshot = snapshots.data?.snapshots[0];
  const refreshDisabled = latestSnapshot?.status === "running";
  const currentData = current.data;

  const refresh = async () => {
    await apiCall(`/experiment/${experiment.id}/contextual-bandit/refresh`, {
      method: "POST",
    });
    await Promise.all([current.mutate(), snapshots.mutate()]);
  };

  if (current.error) {
    return (
      <Callout status="error">
        Failed to load contextual bandit results: {current.error.message}
      </Callout>
    );
  }

  return (
    <Box>
      <Flex align="center" justify="between" mb="3">
        <Box>
          <Text size="x-large" weight="medium">
            Contextual Bandit Results
          </Text>
          <Text as="div" size="medium" color="text-low">
            Current policy weights by learned leaf.
          </Text>
        </Box>
        <Button onClick={refresh} disabled={refreshDisabled}>
          {refreshDisabled ? "Refresh running" : "Refresh now"}
        </Button>
      </Flex>

      {!currentData ? (
        <LoadingSpinner />
      ) : currentData.currentLeafWeights.length === 0 ? (
        <Callout status="info">
          No contextual bandit weights have been generated yet. Click Refresh
          now to run the first snapshot.
        </Callout>
      ) : (
        <Table variant="surface">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Leaf Rule</TableColumnHeader>
              <TableColumnHeader>Users</TableColumnHeader>
              <TableColumnHeader>Per-arm weights</TableColumnHeader>
              <TableColumnHeader>Best-arm probabilities</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentData.currentLeafWeights.map((leaf) => {
              const result = currentData.latestEvent?.contextResults.find(
                (context) => context.contextId === leaf.contextId,
              );
              return (
                <TableRow key={leaf.contextId}>
                  <TableCell>{getConditionLabel(leaf)}</TableCell>
                  <TableCell>{result?.totalUsers ?? "Not available"}</TableCell>
                  <TableCell>
                    {leaf.weights.map(formatPercent).join(" / ")}
                  </TableCell>
                  <TableCell>
                    {getBestArmProbabilities(leaf, currentData.latestEvent)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Flex gap="2" align="center" wrap="wrap" mt="4">
        <Text size="medium" weight="medium">
          Snapshot history
        </Text>
        {snapshots.data?.snapshots.length ? (
          snapshots.data.snapshots.map((snapshot) => (
            <Tooltip
              key={snapshot.id}
              body={
                snapshot.error
                  ? snapshot.error
                  : snapshot.weightsWereUpdated
                    ? "Weights updated"
                    : "Weights unchanged"
              }
            >
              <Box
                px="2"
                py="1"
                style={{
                  border: "1px solid var(--gray-a6)",
                  borderRadius: 4,
                }}
              >
                <Text size="small">
                  {date(snapshot.dateCreated)} · {snapshot.status}
                  {snapshot.weightsWereUpdated ? " · updated" : ""}
                </Text>
              </Box>
            </Tooltip>
          ))
        ) : (
          <Text size="medium" color="text-low">
            No snapshots yet
          </Text>
        )}
      </Flex>
    </Box>
  );
};
