import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { ExperimentAnalysisSettingsDraft } from "shared/validators";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import DecisionCriteriaSelectorModal from "@/components/DecisionCriteria/DecisionCriteriaSelectorModal";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import { useDecisionMakingSummary } from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useExperimentFieldEdit, useStagedState } from "./ExperimentEdits";
import QuickEditButton, { clicksQuickEdit } from "./QuickEditButton";
import SetupFieldRow from "./SetupFieldRow";
import { scheduledEnd, scheduleTimes } from "./statusSchedule";

const INNER_LABEL_WIDTH = "128px";

// A grey panel, as the targeting funnel's.
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

// The rules themselves are a click away, in the criteria's dialog.
function CriteriaName({ criteria }: { criteria: DecisionCriteriaData }) {
  return (
    <Flex align="center" gap="1">
      <Text color="text-high">{criteria.name}</Text>
      {criteria.description ? (
        <Tooltip content={criteria.description}>
          <span style={{ display: "flex", color: "var(--color-text-mid)" }}>
            <PiInfo />
          </span>
        </Tooltip>
      ) : null}
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
        {tooltip ? (
          <Tooltip content={tooltip}>
            <span style={{ display: "flex", color: "var(--color-text-mid)" }}>
              <PiInfo />
            </span>
          </Tooltip>
        ) : null}
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
  const permissionsUtil = usePermissionsUtil();
  // Held with the page's other edits until it saves; null clears it.
  const [stagedSchedule, setStagedSchedule] = useStagedState<{
    schedule: ExperimentInterfaceStringDates["statusUpdateSchedule"];
  } | null>("analysis-plan:schedule", null);
  useExperimentFieldEdit("schedule", !!stagedSchedule, plan, {
    label: "Schedule",
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

  const scheduleEditable =
    canEditSchedule && permissionsUtil.canUpdateExperiment(experiment, {});
  const close = () => setEditing(null);
  const times = scheduleTimes(experiment);
  const scheduled = !!(times.starts || times.ends);
  const hasEnd = !!scheduledEnd(experiment.statusUpdateSchedule);

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
          experiment={experiment}
          initialCriteria={summary.decisionCriteria}
          canEdit
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
        label="Schedule"
        {...(scheduled ? { content: "panel" } : { labelAlign: "center" })}
      >
        <Panel>
          <Flex
            align={scheduled ? "start" : "center"}
            justify="between"
            gap="3"
            className={scheduleEditable ? clicksQuickEdit : undefined}
          >
            {scheduled ? (
              <Flex direction="column" gap="3" flexGrow="1">
                <InnerRow label={times.started ? "Started" : "Starts"}>
                  <Text color="text-high">{times.starts ?? "Manually"}</Text>
                </InnerRow>
                <InnerRow label={times.ended ? "Ended" : "Ends"}>
                  <Text color="text-high">{times.ends ?? "Manually"}</Text>
                </InnerRow>
              </Flex>
            ) : (
              <Text color="text-high">Starts and ends manually.</Text>
            )}
            {scheduleEditable ? (
              <QuickEditButton
                label="Edit schedule"
                onClick={() => setEditing("schedule")}
                labelTooltip={false}
                fillsRow
              />
            ) : null}
          </Flex>
        </Panel>
      </SetupFieldRow>

      {summary ? (
        <SetupFieldRow label="Decision" content="panel">
          <Panel>
            <Flex direction="column" gap="3">
              <InnerRow label="Decision criteria">
                {canEdit ? (
                  <Flex
                    align="start"
                    justify="between"
                    gap="3"
                    className={clicksQuickEdit}
                  >
                    <CriteriaName criteria={summary.decisionCriteria} />
                    <QuickEditButton
                      label="Edit decision criteria"
                      onClick={() => setEditing("criteria")}
                      labelTooltip={false}
                      fillsRow
                    />
                  </Flex>
                ) : (
                  <Link onClick={() => setEditing("rules")}>
                    <CriteriaName criteria={summary.decisionCriteria} />
                  </Link>
                )}
              </InnerRow>
              <InnerRow
                label="At end"
                tooltip="What happens when the experiment reaches its scheduled end."
              >
                {/* The plan only runs at a scheduled end. */}
                {hasEnd ? (
                  <Flex
                    align="start"
                    justify="between"
                    gap="3"
                    className={scheduleEditable ? clicksQuickEdit : undefined}
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
                    {scheduleEditable ? (
                      <QuickEditButton
                        label="Edit end of experiment"
                        onClick={() => setEditing("endPlan")}
                        labelTooltip={false}
                        fillsRow
                      />
                    ) : null}
                  </Flex>
                ) : (
                  <Text color="text-high">
                    You choose what happens when you stop the experiment
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
