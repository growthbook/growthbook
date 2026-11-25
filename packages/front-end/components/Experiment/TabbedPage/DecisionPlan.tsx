import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { ExperimentAnalysisSettingsDraft } from "shared/validators";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import DecisionCriteriaSelectorModal from "@/components/DecisionCriteria/DecisionCriteriaSelectorModal";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { decisionCriteriaText } from "@/components/DecisionCriteria/decisionCriteriaText";
import { useDecisionMakingSummary } from "./DecisionMakingSettings";
import {
  useExperimentFieldEdit,
  useHoldEditBases,
  useStagedState,
} from "./ExperimentEdits";
import { QuickEditRow } from "./QuickEditButton";
import SetupFieldRow, { InfoTip } from "./SetupFieldRow";
import { scheduledEnd, scheduleTimes } from "./statusSchedule";

const INNER_LABEL_WIDTH = "128px";

function Panel({ children }: { children: ReactNode }) {
  return (
    <Frame
      px="4"
      py="4"
      mb="0"
      noBackground
      style={{ backgroundColor: "var(--gray-a2)", border: "none" }}
    >
      {children}
    </Frame>
  );
}

function CriteriaName({ criteria }: { criteria: DecisionCriteriaData }) {
  const { i18n } = useLingui();
  const { name, description } = decisionCriteriaText(criteria, i18n);
  return (
    <Flex align="center" gap="1">
      <Text color="text-high">{name}</Text>
      {description ? <InfoTip content={description} /> : null}
    </Flex>
  );
}

function InnerRow({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: string;
  children: ReactNode;
}) {
  return (
    <Flex align="start" gap="3" wrap="wrap">
      <Flex align="center" gap="1" flexShrink="0" width={INNER_LABEL_WIDTH}>
        <Text color="text-high" whiteSpace="nowrap">
          {label}
        </Text>
        {tooltip ? <InfoTip content={tooltip} /> : null}
      </Flex>
      <Box flexGrow="1" flexBasis="0" minWidth="200px">
        {children}
      </Box>
    </Flex>
  );
}

// The Analysis Plan's schedule and decision rows, each edited in a dialog
// that stages with the plan.
export default function DecisionPlan({
  experiment: plan,
  stage,
  canEdit,
  canEditSchedule,
  mutate,
  envs,
}: {
  // With the plan's staged settings.
  experiment: ExperimentInterfaceStringDates;
  stage: (changes: ExperimentAnalysisSettingsDraft) => void;
  canEdit: boolean;
  canEditSchedule: boolean;
  mutate: () => void;
  // Environments the experiment reaches; the schedule dialog gates on them.
  envs: string[];
}) {
  const { t, i18n } = useLingui();
  const permissionsUtil = usePermissionsUtil();
  // Held with the page's other edits until it saves; null clears it.
  const [stagedSchedule, setStagedSchedule] = useStagedState<{
    schedule: ExperimentInterfaceStringDates["statusUpdateSchedule"];
  } | null>("analysis-plan:schedule", null);
  useExperimentFieldEdit("schedule", !!stagedSchedule, plan, {
    label: t`Schedule`,
    statusBound: true,
    fields: () => ({ statusUpdateSchedule: stagedSchedule?.schedule ?? null }),
    onSaved: () => setStagedSchedule(null),
    discard: () => setStagedSchedule(null),
  });
  const experiment = stagedSchedule
    ? { ...plan, statusUpdateSchedule: stagedSchedule.schedule }
    : plan;
  const summary = useDecisionMakingSummary(experiment);
  const [editing, setEditing] = useState<
    "schedule" | "endPlan" | "criteria" | "rules" | null
  >(null);
  useHoldEditBases(editing !== null);

  const scheduleEditable =
    canEditSchedule && permissionsUtil.canUpdateExperiment(experiment, {});
  const close = () => setEditing(null);
  const times = scheduleTimes(experiment, i18n);
  const scheduled = !!(times.starts || times.ends);
  const hasEnd = !!scheduledEnd(experiment.statusUpdateSchedule, i18n);

  return (
    <>
      {editing === "schedule" || editing === "endPlan" ? (
        <EditScheduleModal
          focusEndPlan={editing === "endPlan"}
          experiment={experiment}
          mutate={mutate}
          envs={envs}
          close={close}
          stageChanges={(changes) => {
            if ("statusUpdateSchedule" in changes) {
              setStagedSchedule({ schedule: changes.statusUpdateSchedule });
            }
            if (changes.decisionCriteriaId) {
              stage({
                decisionFrameworkSettings: {
                  ...experiment.decisionFrameworkSettings,
                  decisionCriteriaId: changes.decisionCriteriaId,
                },
              });
            }
          }}
        />
      ) : null}
      {editing === "criteria" && summary ? (
        <DecisionCriteriaSelectorModal
          initialCriteria={summary.decisionCriteria}
          stageChanges={(decisionCriteriaId) => {
            if (decisionCriteriaId === summary.decisionCriteria.id) return;
            stage({
              decisionFrameworkSettings: {
                ...experiment.decisionFrameworkSettings,
                decisionCriteriaId,
              },
            });
          }}
          onSubmit={close}
          onClose={close}
        />
      ) : null}
      {editing === "rules" && summary ? (
        <DecisionCriteriaModal
          decisionCriteria={summary.decisionCriteria}
          editable={false}
          mutate={() => {}}
          onClose={close}
        />
      ) : null}

      <SetupFieldRow
        label={t`Schedule`}
        content="panel"
        labelAlign={scheduled ? "top" : "center"}
      >
        <Panel>
          <QuickEditRow
            label={t`Edit schedule`}
            onEdit={scheduleEditable ? () => setEditing("schedule") : null}
            align={scheduled ? "start" : "center"}
          >
            {scheduled ? (
              <Flex direction="column" gap="3" flexGrow="1">
                <InnerRow label={times.started ? t`Started` : t`Starts`}>
                  <Text color="text-high">{times.starts ?? t`Manually`}</Text>
                </InnerRow>
                <InnerRow label={times.ended ? t`Ended` : t`Ends`}>
                  <Text color="text-high">{times.ends ?? t`Manually`}</Text>
                </InnerRow>
              </Flex>
            ) : (
              <Text color="text-high">
                <Trans>Starts and ends manually.</Trans>
              </Text>
            )}
          </QuickEditRow>
        </Panel>
      </SetupFieldRow>

      {summary ? (
        <SetupFieldRow label={t`Decision`} content="panel">
          <Panel>
            <Flex direction="column" gap="3">
              <InnerRow label={t`Decision criteria`}>
                {canEdit ? (
                  <QuickEditRow
                    label={t`Edit decision criteria`}
                    onEdit={() => setEditing("criteria")}
                  >
                    <CriteriaName criteria={summary.decisionCriteria} />
                  </QuickEditRow>
                ) : (
                  <Link onClick={() => setEditing("rules")}>
                    <CriteriaName criteria={summary.decisionCriteria} />
                  </Link>
                )}
              </InnerRow>
              <InnerRow
                label={t`At end`}
                tooltip={t`What happens when the experiment reaches its scheduled end.`}
              >
                {/* The plan only runs at a scheduled end. */}
                {hasEnd ? (
                  <QuickEditRow
                    label={t`Edit end of experiment`}
                    onEdit={
                      scheduleEditable ? () => setEditing("endPlan") : null
                    }
                  >
                    <Flex direction="column" gap="1" minWidth="0">
                      <Text as="div" color="text-high">
                        {summary.endSummary}
                      </Text>
                      {summary.endDetails.map((detail, i) => (
                        <Text as="div" color="text-high" key={i}>
                          {detail}
                        </Text>
                      ))}
                    </Flex>
                  </QuickEditRow>
                ) : (
                  <Text color="text-high">
                    <Trans>
                      You choose what happens when you stop the experiment.
                    </Trans>
                  </Text>
                )}
              </InnerRow>
            </Flex>
          </Panel>
        </SetupFieldRow>
      ) : null}
    </>
  );
}
