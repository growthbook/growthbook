import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
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
import ConfirmDialog from "@/ui/ConfirmDialog";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import QaOverrideModal from "@/components/Experiment/QaOverrides/QaOverrideModal";
import {
  qaOverrideIncludedLabel,
  QaOverrideSetBy,
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
  const { data, mutate } = useSdkConnectionQaOverrides(connection.id);
  const [editing, setEditing] = useState<{
    override: ExperimentQaOverrideInterface;
    experiment: QaOverrideExperiment;
  } | null>(null);
  const [confirmStopAll, setConfirmStopAll] = useState(false);

  const overrides = data?.overrides ?? [];
  const experiments = data?.experiments ?? [];
  const environment = environments.find((e) => e.id === connection.environment);
  const envEligible = !!environment && !isProductionEnvironment(environment);

  const canEdit = (experiment: QaOverrideExperiment) =>
    permissionsUtil.canRunExperiment(experiment, [connection.environment]);

  const stopOverride = async (override: ExperimentQaOverrideInterface) => {
    await apiCall(`/qa-overrides/${override.id}`, { method: "DELETE" });
    await mutate();
  };

  return (
    <Frame>
      {editing && (
        <QaOverrideModal
          experiment={editing.experiment}
          existing={editing.override}
          lockedConnection={connection}
          close={() => setEditing(null)}
          onSaved={async () => {
            await mutate();
            setEditing(null);
          }}
        />
      )}
      {confirmStopAll && (
        <ConfirmDialog
          title="Stop all QA overrides?"
          content="This connection will stop receiving every draft experiment listed here."
          yesText="Stop all"
          color="red"
          onCancel={() => setConfirmStopAll(false)}
          onConfirm={async () => {
            await apiCall(`/qa-overrides/sdk-connection/${connection.id}`, {
              method: "DELETE",
            });
            await mutate();
            setConfirmStopAll(false);
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
            Requests with this client key get the{" "}
            <Text weight="medium">{connection.environment}</Text>{" "}
            environment&apos;s live config plus the draft experiments below.
            Each one clears itself when its experiment starts.
          </Text>
        </Box>
        {overrides.length > 0 && (
          <Flex align="center" flexShrink="0">
            <Button
              variant="ghost"
              color="red"
              onClick={() => setConfirmStopAll(true)}
            >
              Stop all
            </Button>
          </Flex>
        )}
      </Flex>

      {!envEligible ? (
        <Callout status="info">
          The <Text weight="medium">{connection.environment}</Text> environment
          is a production environment. Mark it as non-production in Settings →
          Environments. <Link href="/environments">Manage environments</Link>
        </Callout>
      ) : overrides.length === 0 ? (
        <Text color="text-low">
          No draft experiments are being served to this connection.
        </Text>
      ) : (
        <Table variant="ghost">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Experiment</TableColumnHeader>
              <TableColumnHeader>Variation</TableColumnHeader>
              <TableColumnHeader>Included</TableColumnHeader>
              <TableColumnHeader>Set by</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((override) => {
              const experiment = experiments.find(
                (e) => e.id === override.experiment,
              );
              const phase = experiment?.phases[experiment.phases.length - 1];
              return (
                <TableRow key={override.id}>
                  <TableCell>
                    <Flex direction="column" gap="1">
                      <Link href={`/experiment/${override.experiment}`}>
                        {experiment?.name ?? override.experiment}
                      </Link>
                      <Text size="sm" color="text-low">
                        Draft · hidden from other connections
                      </Text>
                    </Flex>
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
                    <Text color="text-mid">
                      {qaOverrideIncludedLabel(override, phase)}
                    </Text>
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
                          onClick={() => stopOverride(override)}
                        >
                          Stop
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
