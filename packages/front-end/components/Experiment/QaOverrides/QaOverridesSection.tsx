import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { TruncateMiddleWithTooltip } from "@/ui/TruncateMiddleWithTooltip";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import QaOverrideModal from "./QaOverrideModal";
import {
  experimentTargetingLabel,
  QaOverrideAdditionalTargeting,
  QaOverrideSetBy,
  QaOverrideVariation,
} from "./QaOverrideSummary";

export default function QaOverridesSection({
  experiment,
  linkedFeatures,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const { data, mutate } = useExperimentQaOverrides(experiment.id);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; override: ExperimentQaOverrideInterface }
    | null
  >(null);
  const [confirmStopAll, setConfirmStopAll] = useState(false);

  const overrides = data?.overrides ?? [];
  const connections = data?.sdkConnections ?? [];
  const variations = getLatestPhaseVariations(experiment);
  const enabledEnvs = environments.filter((e) => e.qaOverridesEnabled);
  const canEdit = permissionsUtil.canRunExperiment(
    experiment,
    enabledEnvs.map((e) => e.id),
  );

  const stopOverride = async (override: ExperimentQaOverrideInterface) => {
    await apiCall(`/qa-overrides/${override.id}`, { method: "DELETE" });
    await mutate();
  };

  return (
    <Frame>
      {modal && (
        <QaOverrideModal
          experiment={experiment}
          linkedFeatures={linkedFeatures}
          existing={modal.mode === "edit" ? modal.override : undefined}
          close={() => setModal(null)}
          onSaved={async () => {
            await mutate();
            setModal(null);
          }}
        />
      )}
      {confirmStopAll && (
        <ConfirmDialog
          title="Stop all QA overrides?"
          content="This draft will stop being served to every SDK Connection listed here."
          yesText="Stop all"
          color="red"
          onCancel={() => setConfirmStopAll(false)}
          onConfirm={async () => {
            await apiCall(`/qa-overrides/experiment/${experiment.id}`, {
              method: "DELETE",
            });
            await mutate();
            setConfirmStopAll(false);
          }}
        />
      )}
      <Flex align="start" justify="between" gap="3" mb="3">
        <Box>
          <Heading as="h3" size="sm" color="text-high" mb="1">
            Experiment QA Overrides
          </Heading>
          <Text color="text-low" size="sm">
            While in draft, only the SDK Connections below will be able to see
            this experiment.
          </Text>
        </Box>
        {canEdit && enabledEnvs.length > 0 && (
          <Flex gap="2" flexShrink="0">
            {overrides.length > 0 && (
              <Button
                variant="outline"
                color="red"
                size="sm"
                onClick={() => setConfirmStopAll(true)}
              >
                Stop all
              </Button>
            )}
            <Button
              variant="soft"
              size="sm"
              onClick={() => setModal({ mode: "create" })}
            >
              Add override
            </Button>
          </Flex>
        )}
      </Flex>

      {enabledEnvs.length === 0 ? (
        <Callout status="info">
          Enable QA overrides on an environment to serve this draft to its SDK
          Connections. <Link href="/environments">Manage environments</Link>
        </Callout>
      ) : overrides.length === 0 ? (
        <Text color="text-low">
          No QA overrides yet. Add one to serve this draft to a specific SDK
          Connection.
        </Text>
      ) : (
        <Table size="sm" layout="auto">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Connection</TableColumnHeader>
              <TableColumnHeader>Variation</TableColumnHeader>
              <TableColumnHeader>Additional targeting</TableColumnHeader>
              <TableColumnHeader>Experiment targeting</TableColumnHeader>
              <TableColumnHeader>Set by</TableColumnHeader>
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((override) => {
              const connection = connections.find(
                (c) => c.id === override.sdkConnection,
              );
              return (
                <TableRow key={override.id}>
                  <TableCell>
                    <Flex direction="column" gap="1">
                      <Flex align="center" gap="2">
                        <Link href={`/sdks/${override.sdkConnection}`}>
                          {connection?.name ?? override.sdkConnection}
                        </Link>
                        <Badge
                          label={override.environment}
                          color="gray"
                          variant="soft"
                        />
                      </Flex>
                      {connection?.key && (
                        <code>
                          <TruncateMiddleWithTooltip
                            text={connection.key}
                            maxChars={28}
                          />
                        </code>
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell>
                    <QaOverrideVariation
                      override={override}
                      variations={variations}
                    />
                  </TableCell>
                  <TableCell>
                    <QaOverrideAdditionalTargeting override={override} />
                  </TableCell>
                  <TableCell>{experimentTargetingLabel(override)}</TableCell>
                  <TableCell>
                    <QaOverrideSetBy override={override} />
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <Flex gap="2" justify="end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setModal({ mode: "edit", override })}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          color="red"
                          size="sm"
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
