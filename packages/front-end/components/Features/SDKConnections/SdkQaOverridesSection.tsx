import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { isProductionEnvironment } from "shared/util";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useSdkConnectionQaOverrides, {
  QaOverrideExperiment,
} from "@/hooks/useSdkConnectionQaOverrides";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import QaOverrideModal from "@/components/Experiment/QaOverrides/QaOverrideModal";
import {
  QaOverrideFiltersSummary,
  QaOverrideSetBy,
  QaOverrideStatusBadge,
  QaOverrideVariation,
} from "@/components/Experiment/QaOverrides/QaOverrideSummary";

export default function SdkQaOverridesSection({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const { data, error, mutate } = useSdkConnectionQaOverrides(connection.id);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    override: ExperimentQaOverrideWithStatus;
    experiment: QaOverrideExperiment;
  } | null>(null);

  const overrides = data?.overrides ?? [];
  const experiments = data?.experiments ?? [];
  const environment = environments.find((e) => e.id === connection.environment);
  const envEligible = !!environment && !isProductionEnvironment(environment);

  const canEdit = (experiment: QaOverrideExperiment) =>
    permissionsUtil.canRunExperiment(experiment, [connection.environment]);

  const deleteOverride = async (override: ExperimentQaOverrideWithStatus) => {
    setActionError(null);
    await apiCall(`/qa-overrides/${override.id}`, { method: "DELETE" });
    await mutate();
  };

  return (
    <Frame>
      {editing && (
        <QaOverrideModal
          experiment={editing.experiment}
          existing={editing.override}
          close={() => setEditing(null)}
          onSaved={async () => {
            await mutate();
            setEditing(null);
          }}
        />
      )}
      <Flex align="start" justify="between" gap="3" mb="3">
        <Box>
          <Flex align="center" gap="2" mb="1">
            <Heading color="text-high" as="h4" size="sm" mb="0">
              QA Overrides
            </Heading>
            {overrides.length > 0 && (
              <Badge
                label={String(overrides.length)}
                color="gray"
                variant="soft"
                radius="full"
              />
            )}
          </Flex>
          <Text color="text-mid">
            Draft experiments served to the{" "}
            <Text weight="medium">{connection.environment}</Text> environment
            that reach this connection. Each one is removed when its experiment
            starts.
          </Text>
        </Box>
      </Flex>

      {error && (
        <Callout status="error" mb="3">
          Could not load QA overrides: {error.message}
        </Callout>
      )}
      {actionError && (
        <Callout status="error" mb="3">
          {actionError}
        </Callout>
      )}

      {!envEligible ? (
        <Callout status="info">
          <Text weight="medium">{connection.environment}</Text> is a production
          environment, so QA overrides aren&apos;t available on this connection.{" "}
          <Link href="/environments">Manage environments</Link>
        </Callout>
      ) : overrides.length === 0 ? (
        !error && (
          <Text color="text-low">
            No draft experiments are being served to this connection.
          </Text>
        )
      ) : (
        <Table variant="ghost">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Experiment</TableColumnHeader>
              <TableColumnHeader>Filters</TableColumnHeader>
              <TableColumnHeader>Variation</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader>Set by</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((override) => {
              const experiment = experiments.find(
                (e) => e.id === override.experiment,
              );
              return (
                <TableRow key={override.id}>
                  <TableCell>
                    <Link href={`/experiment/${override.experiment}`}>
                      {experiment?.name ?? override.experiment}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <QaOverrideFiltersSummary override={override} />
                  </TableCell>
                  <TableCell>
                    <QaOverrideVariation
                      override={override}
                      variations={
                        experiment ? getLatestPhaseVariations(experiment) : []
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <QaOverrideStatusBadge override={override} />
                  </TableCell>
                  <TableCell>
                    <QaOverrideSetBy override={override} />
                  </TableCell>
                  <TableCell>
                    {experiment && canEdit(experiment) && (
                      <Flex gap="4" justify="end">
                        <Button
                          variant="ghost"
                          onClick={() => setEditing({ override, experiment })}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          color="red"
                          setError={setActionError}
                          onClick={() => deleteOverride(override)}
                        >
                          Remove
                        </Button>
                      </Flex>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Frame>
  );
}
