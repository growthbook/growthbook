import { useMemo, useState } from "react";
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
import { groupQaOverrides } from "@/services/qaOverrides";
import { InfoTip } from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import QaOverrideModal from "@/components/Experiment/QaOverrides/QaOverrideModal";
import QaOverridesTable, {
  QaOverrideRow,
} from "@/components/Experiment/QaOverrides/QaOverridesTable";
import { useQaOverrideNameLookups } from "@/components/Experiment/QaOverrides/QaOverrideFilterChips";

const ABOUT =
  "Draft experiments served to this connection's environment that reach it. " +
  "Each override is removed when its experiment starts.";

/** Every draft experiment's QA overrides that reach this SDK Connection. */
export default function SdkQaOverridesSection({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const { data, error, mutate } = useSdkConnectionQaOverrides(connection.id);
  const lookups = useQaOverrideNameLookups([connection]);
  const [editing, setEditing] = useState<{
    override: ExperimentQaOverrideWithStatus;
    experiment: QaOverrideExperiment;
  } | null>(null);

  const overrides = useMemo(() => data?.overrides ?? [], [data]);
  const experiments = useMemo(() => data?.experiments ?? [], [data]);
  const environment = environments.find((e) => e.id === connection.environment);
  const envEligible = !!environment && !isProductionEnvironment(environment);

  const experimentOf = (override: ExperimentQaOverrideWithStatus) =>
    experiments.find((e) => e.id === override.experiment);

  // One environment, so one group: the table shows the experiment per row.
  const groups = useMemo(
    () =>
      groupQaOverrides(overrides, [connection.environment]).map((g) => ({
        environment: g.environment,
        rows: g.rows.map((r) => {
          const experiment = experiments.find(
            (e) => e.id === r.item.experiment,
          );
          return {
            priority: r.priority,
            item: {
              override: r.item,
              experiment: experiment
                ? { id: experiment.id, name: experiment.name }
                : undefined,
              variations: experiment
                ? getLatestPhaseVariations(experiment)
                : [],
            } as QaOverrideRow,
          };
        }),
      })),
    [overrides, experiments, connection.environment],
  );

  const canEdit = (row: QaOverrideRow) => {
    const experiment = experimentOf(row.override);
    return (
      !!experiment &&
      permissionsUtil.canRunExperiment(experiment, [connection.environment])
    );
  };

  // Most connections are production, where QA overrides can't exist; a card
  // saying so on every one of them is noise.
  if (!envEligible) return null;

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
      <Flex align="center" gap="2" mb="3">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          QA Overrides
        </Heading>
        <InfoTip content={ABOUT} />
        <Box flexGrow="1" />
      </Flex>

      {error && (
        <Callout status="error" mb="3">
          Could not load QA overrides: {error.message}
        </Callout>
      )}

      {overrides.length === 0 ? (
        !error && (
          <Text color="text-low">
            No draft experiments are being served to this connection.
          </Text>
        )
      ) : (
        <QaOverridesTable
          groups={groups}
          leading="experiment"
          lookups={lookups}
          canEdit={canEdit}
          onEdit={(row) => {
            const experiment = experimentOf(row.override);
            if (experiment) setEditing({ override: row.override, experiment });
          }}
          onRemove={async (row) => {
            await apiCall(`/qa-overrides/${row.override.id}`, {
              method: "DELETE",
            });
            await mutate();
          }}
          removeConfirmation={(row) =>
            `${row.experiment?.name ?? row.override.experiment} will stop being served to ${connection.environment} through this override, for every connection it reaches.`
          }
        />
      )}
    </Frame>
  );
}
