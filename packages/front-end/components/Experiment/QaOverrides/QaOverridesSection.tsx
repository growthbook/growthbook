import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowDownBold, PiArrowUpBold, PiPlusBold } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { getLatestPhaseVariations } from "shared/experiments";
import { isProductionEnvironment } from "shared/util";
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
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import QaOverrideModal from "./QaOverrideModal";
import {
  QaOverrideFiltersSummary,
  QaOverrideSetBy,
  QaOverrideStatusBadge,
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
  const variations = getLatestPhaseVariations(experiment);
  const eligibleEnvs = environments.filter((e) => !isProductionEnvironment(e));
  const canEdit = permissionsUtil.canRunExperiment(
    experiment,
    eligibleEnvs.map((e) => e.id),
  );

  const deleteOverride = async (override: ExperimentQaOverrideInterface) => {
    await apiCall(`/qa-overrides/${override.id}`, { method: "DELETE" });
    await mutate();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const ids = overrides.map((o) => o.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await apiCall(`/qa-overrides/experiment/${experiment.id}/order`, {
      method: "PUT",
      body: JSON.stringify({ overrideIds: ids }),
    });
    await mutate();
  };
  const canReorder = canEdit && overrides.length > 1;

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
          title="Remove all QA overrides?"
          content="This draft will stop being served to every environment listed here."
          yesText="Remove all"
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
          <Heading color="text-high" as="h4" size="sm" mb="1">
            QA Overrides
          </Heading>
          <Text color="text-mid">
            Serve this draft to a non-production environment before it starts.
            When several overrides match a request, the first one wins.
          </Text>
        </Box>
        {canEdit && eligibleEnvs.length > 0 && (
          <Flex align="center" gap="3" flexShrink="0">
            {overrides.length > 1 && (
              <Button
                variant="ghost"
                color="red"
                onClick={() => setConfirmStopAll(true)}
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

      {eligibleEnvs.length === 0 ? (
        <Callout status="info">
          Every environment is marked as production. Turn off &quot;This is a
          production environment&quot; on one in Settings → Environments to use
          QA overrides. <Link href="/environments">Manage environments</Link>
        </Callout>
      ) : overrides.length === 0 ? (
        <Text color="text-low">
          No QA overrides yet. Add one to serve this draft to an environment.
        </Text>
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
            {overrides.map((override, i) => (
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
                        onClick={() => move(i, -1)}
                      >
                        <PiArrowUpBold />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        color="gray"
                        size="1"
                        aria-label="Move down"
                        disabled={i === overrides.length - 1}
                        onClick={() => move(i, 1)}
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
                  <QaOverrideStatusBadge
                    override={override}
                    linkedFeatures={linkedFeatures}
                  />
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
                        onClick={() => deleteOverride(override)}
                      >
                        Remove
                      </Button>
                    </Flex>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Frame>
  );
}
