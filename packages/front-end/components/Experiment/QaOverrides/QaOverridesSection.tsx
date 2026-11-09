import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowDownBold, PiArrowUpBold, PiPlusBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideWithStatus } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { isProductionEnvironment } from "shared/util";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useExperimentQaOverrides from "@/hooks/useExperimentQaOverrides";
import ExposureLogsCard from "@/components/HealthTab/ExposureLogsCard";
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
import QaOverrideModal from "./QaOverrideModal";
import QaOverrideFeatureGate from "./QaOverrideFeatureGate";
import {
  QaOverrideFiltersSummary,
  QaOverrideSetBy,
  QaOverrideStatusBadge,
  QaOverrideVariation,
} from "./QaOverrideSummary";

export default function QaOverridesSection({
  experiment,
  linkedFeatures,
  mutateExperiment,
}: {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  // Refreshes the experiment (and its linked features) after a flag is toggled.
  mutateExperiment?: () => Promise<unknown> | void;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const { data, error, mutate } = useExperimentQaOverrides(experiment.id);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; override: ExperimentQaOverrideWithStatus }
    | null
  >(null);
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const overrides = data?.overrides ?? [];
  const variations = getLatestPhaseVariations(experiment);
  const eligibleEnvs = environments.filter((e) => !isProductionEnvironment(e));
  // Permissions are per environment, so check the one each row targets and
  // offer "Add" when any eligible environment is allowed.
  const canEditIn = (environment: string) =>
    permissionsUtil.canRunExperiment(experiment, [environment]);
  const canAdd = eligibleEnvs.some((e) => canEditIn(e.id));
  const editableOverrides = overrides.filter((o) => canEditIn(o.environment));

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    await action();
    await mutate();
  };

  const move = (index: number, direction: -1 | 1) =>
    run(async () => {
      const ids = overrides.map((o) => o.id);
      const target = index + direction;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await apiCall(`/qa-overrides/experiment/${experiment.id}/order`, {
        method: "PUT",
        body: JSON.stringify({ overrideIds: ids }),
      });
    });
  const canReorder =
    overrides.length > 1 && editableOverrides.length === overrides.length;

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
          onFeatureChanged={mutateExperiment}
        />
      )}
      {confirmRemoveAll && (
        <ConfirmDialog
          title="Remove all QA overrides?"
          content="This draft will stop being served to every environment listed here."
          yesText="Remove all"
          color="red"
          onCancel={() => setConfirmRemoveAll(false)}
          onConfirm={async () => {
            try {
              await run(() =>
                apiCall(`/qa-overrides/experiment/${experiment.id}`, {
                  method: "DELETE",
                }),
              );
            } catch (e) {
              setActionError(e.message);
            }
            setConfirmRemoveAll(false);
          }}
        />
      )}
      <Flex align="start" justify="between" gap="3" mb="3">
        <Box>
          <Heading color="text-high" as="h4" size="sm" mb="1">
            QA Overrides
          </Heading>
          <Text color="text-mid">
            Serve this draft to a non-production environment before it starts.
            When several overrides match a request, the first one wins.
          </Text>
        </Box>
        {canAdd && (
          <Flex align="center" gap="3" flexShrink="0">
            {editableOverrides.length > 1 && (
              <Button
                variant="ghost"
                color="red"
                onClick={() => setConfirmRemoveAll(true)}
              >
                Remove all
              </Button>
            )}
            <Button
              variant="outline"
              icon={<PiPlusBold />}
              onClick={() => setModal({ mode: "create" })}
            >
              Add override
            </Button>
          </Flex>
        )}
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

      {eligibleEnvs.length === 0 ? (
        <Callout status="info">
          Every environment is marked as production. Turn off &quot;This is a
          production environment&quot; on one in Settings → Environments to use
          QA overrides. <Link href="/environments">Manage environments</Link>
        </Callout>
      ) : overrides.length === 0 ? (
        !error && (
          <Text color="text-low">
            No QA overrides yet. Add one to serve this draft to an environment.
          </Text>
        )
      ) : (
        <Table variant="ghost">
          <TableHeader>
            <TableRow>
              {canReorder && <TableColumnHeader style={{ width: 70 }} />}
              <TableColumnHeader>Environment</TableColumnHeader>
              <TableColumnHeader>Filters</TableColumnHeader>
              <TableColumnHeader>Variation</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader>Set by</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overrides.map((override, i) => {
              const canEdit = canEditIn(override.environment);
              return (
                <TableRow key={override.id}>
                  {canReorder && (
                    <TableCell>
                      <Flex gap="2">
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() =>
                            move(i, -1).catch((e) => setActionError(e.message))
                          }
                        >
                          <PiArrowUpBold />
                        </IconButton>
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          aria-label="Move down"
                          disabled={i === overrides.length - 1}
                          onClick={() =>
                            move(i, 1).catch((e) => setActionError(e.message))
                          }
                        >
                          <PiArrowDownBold />
                        </IconButton>
                      </Flex>
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge label={override.environment} color="gray" />
                  </TableCell>
                  <TableCell>
                    <QaOverrideFiltersSummary override={override} />
                  </TableCell>
                  <TableCell>
                    <QaOverrideVariation
                      override={override}
                      variations={variations}
                    />
                  </TableCell>
                  <TableCell>
                    <Flex direction="column" gap="2" align="start">
                      <QaOverrideStatusBadge override={override} />
                      {canEdit && (
                        <QaOverrideFeatureGate
                          environment={override.environment}
                          waitingOn={override.waitingOn}
                          linkedFeatures={linkedFeatures}
                          onChanged={async () => {
                            await mutateExperiment?.();
                            await mutate();
                          }}
                        />
                      )}
                    </Flex>
                  </TableCell>
                  <TableCell>
                    <QaOverrideSetBy override={override} />
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <Flex gap="4" justify="end">
                        <Button
                          variant="ghost"
                          onClick={() => setModal({ mode: "edit", override })}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          color="red"
                          setError={setActionError}
                          onClick={() =>
                            run(() =>
                              apiCall(`/qa-overrides/${override.id}`, {
                                method: "DELETE",
                              }),
                            )
                          }
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

      {overrides.length > 0 && experiment.datasource && (
        <Box mt="4">
          <ExposureLogsCard
            experiment={experiment}
            isTabActive={true}
            phase={experiment.phases.length - 1}
            exposureSource="qa"
            title="QA Exposure Logs"
          />
        </Box>
      )}
    </Frame>
  );
}
