import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { linkedFeatureEnvStates } from "shared/util";
import Text from "@/ui/Text";
import Badge from "@/ui/Badge";
import Tooltip from "@/ui/Tooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import EditExperimentEnvironmentsModal from "@/components/Experiment/EditExperimentEnvironmentsModal";
import {
  EnvironmentStateIcon,
  getEnvironmentStates,
  stageEnvironmentInputs,
} from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import { environmentStatesDiffer } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import { FlagEnvironmentsDraft } from "./ExperimentEdits";
import { QuickEditRow } from "./QuickEditButton";

const SHOWN_ENVIRONMENTS = 6;

function environment({ env, isActive }: { env: string; isActive: boolean }) {
  return (
    <Flex key={env} align="center" gap="1" minWidth="0">
      <EnvironmentStateIcon isActive={isActive} />
      <Text color="text-high">{env}</Text>
    </Flex>
  );
}

// Where the experiment's own Feature Flag runs, without the flag toggle and
// rule behind it. Its column saves a staged change with the values.
export default function ManagedFlagEnvironments({
  experiment,
  info,
  flagEnvironments,
  canEdit,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  flagEnvironments: FlagEnvironmentsDraft;
  canEdit: boolean;
}) {
  const permissionsUtil = usePermissionsUtil();
  const [editing, setEditing] = useState(false);
  const { feature, pendingDraft } = info;
  const stagedScope = flagEnvironments.value[feature.id] ?? null;
  const storedStates = pendingDraft ?? {
    environmentStates: info.liveEnvironmentStates ?? info.environmentStates,
  };
  const storedInputs = pendingDraft
    ? pendingDraft.environmentInputs
    : (info.liveEnvironmentInputs ?? info.environmentInputs);
  const states = getEnvironmentStates(
    stagedScope && storedInputs
      ? {
          environmentStates: linkedFeatureEnvStates(
            stageEnvironmentInputs(storedInputs, stagedScope),
          ),
        }
      : storedStates,
  );
  // Archived, it serves nothing; its column says why.
  if (!states.length || info.state === "archived") return null;

  const editable =
    canEdit &&
    !info.pendingRemoval &&
    permissionsUtil.canEditFeatureDrafts(feature);
  const unpublished =
    experiment.status !== "draft" &&
    (!!stagedScope || environmentStatesDiffer(info));
  const hidden = states.slice(SHOWN_ENVIRONMENTS);

  return (
    <Box mb="4">
      {editing ? (
        <EditExperimentEnvironmentsModal
          info={info}
          stagedScope={stagedScope}
          environmentStates={getEnvironmentStates(storedStates)}
          storedAllEnvironments={
            pendingDraft
              ? (pendingDraft.allEnvironments ?? null)
              : (info.liveAllEnvironments ?? null)
          }
          environmentInputs={storedInputs}
          showFlag={false}
          close={() => setEditing(false)}
          apply={(scope) => {
            flagEnvironments.set(feature.id, scope);
            setEditing(false);
          }}
        />
      ) : null}
      <QuickEditRow
        label="Edit environments"
        onEdit={editable ? () => setEditing(true) : null}
        align="center"
        centered
      >
        <Text size="lg" weight="medium" color="text-high">
          Environments:
        </Text>
        <Flex align="center" gap="4" wrap="wrap">
          {states.slice(0, SHOWN_ENVIRONMENTS).map(environment)}
          {hidden.length ? (
            <Tooltip
              content={
                <Flex direction="column" gap="1">
                  {hidden.map(environment)}
                </Flex>
              }
            >
              <Badge
                label={`+${hidden.length}`}
                color="gray"
                variant="soft"
                radius="full"
                size="xs"
              />
            </Tooltip>
          ) : null}
        </Flex>
        {unpublished ? (
          <Text size="sm" color="text-low">
            Takes effect when published.
          </Text>
        ) : null}
      </QuickEditRow>
    </Box>
  );
}
