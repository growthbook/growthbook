import { ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo, PiPencilSimple } from "react-icons/pi";
import {
  DecisionCriteriaData,
  ExperimentInterfaceStringDates,
} from "shared/types/experiment";
import { PRESET_DECISION_CRITERIAS } from "shared/enterprise";
import { ExperimentAnalysisSettingsDraft } from "shared/validators";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import { useDecisionMakingSummary } from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import SelectField from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useEditsBlockedReason } from "./ExperimentEdits";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import SetupFieldRow from "./SetupFieldRow";
import { scheduleSummary } from "./statusSchedule";

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
    <Flex align="center" gap="3" wrap="wrap">
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
      {children}
    </Flex>
  );
}

// The Analysis Plan's schedule and decision rows. The decision criteria stage
// with the plan; the schedule writes from its own dialog, so it waits while
// the page holds unsaved edits.
export default function DecisionPlan({
  experiment,
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
  const summary = useDecisionMakingSummary(experiment);
  const editsBlocked = useEditsBlockedReason();
  const [editing, setEditing] = useState<"schedule" | "rules" | null>(null);
  const { data } = useApi<{ decisionCriteria: DecisionCriteriaData[] }>(
    "/decision-criteria",
    { shouldRun: () => !!summary },
  );
  const criteria = [
    ...PRESET_DECISION_CRITERIAS,
    ...(data?.decisionCriteria ?? []),
  ];

  const scheduleEditable =
    canEditSchedule && permissionsUtil.canUpdateExperiment(experiment, {});
  const close = () => setEditing(null);

  return (
    <>
      {editing === "schedule" ? (
        <EditScheduleModal
          experiment={experiment}
          mutate={mutate}
          envs={envs}
          close={close}
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

      <SetupFieldRow label="Schedule" labelAlign="center">
        <Panel>
          <Flex align="center" justify="between" gap="3">
            <Text color="text-mid">
              {scheduleSummary(experiment.statusUpdateSchedule)}
            </Text>
            {scheduleEditable ? (
              <Tooltip content={editsBlocked} enabled={!!editsBlocked}>
                <Button
                  variant="outline"
                  color="gray"
                  icon={<PiPencilSimple />}
                  disabled={!!editsBlocked}
                  onClick={() => setEditing("schedule")}
                >
                  Edit
                </Button>
              </Tooltip>
            ) : null}
          </Flex>
        </Panel>
      </SetupFieldRow>

      {summary ? (
        <SetupFieldRow label="Decision" content="panel">
          <Panel>
            <Flex direction="column" gap="3">
              <InnerRow label="Decision criteria">
                <Box width="min(100%, 320px)">
                  <SelectField
                    value={summary.decisionCriteria.id}
                    onChange={(decisionCriteriaId) => {
                      if (decisionCriteriaId === summary.decisionCriteria.id) {
                        return;
                      }
                      stage({
                        decisionFrameworkSettings: {
                          ...experiment.decisionFrameworkSettings,
                          decisionCriteriaId,
                        },
                      });
                    }}
                    options={criteria.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                    // The menu describes each; the closed field names it.
                    formatOptionLabel={({ value, label }, { context }) => {
                      const description =
                        context === "menu"
                          ? criteria.find((c) => c.id === value)?.description
                          : null;
                      return (
                        <>
                          {label}
                          {description ? (
                            <Text as="div" size="sm" color="text-mid">
                              {description}
                            </Text>
                          ) : null}
                        </>
                      );
                    }}
                    sort={false}
                    disabled={!canEdit}
                  />
                </Box>
                <Link onClick={() => setEditing("rules")}>View rules</Link>
              </InnerRow>
              <InnerRow
                label="At end"
                tooltip="What happens when the experiment reaches its scheduled end."
              >
                <Flex align="start" gap="2" className={revealsQuickEdit}>
                  <Box minWidth="0">
                    <Text as="div" color="text-high">
                      {summary.endSummary}
                    </Text>
                    {summary.endDetails.map((detail) => (
                      <Text as="div" color="text-mid" key={detail}>
                        {detail}
                      </Text>
                    ))}
                  </Box>
                  {scheduleEditable ? (
                    <QuickEditButton
                      label="Edit end of experiment"
                      onClick={() => setEditing("schedule")}
                      blockedReason={editsBlocked}
                      labelTooltip={false}
                    />
                  ) : null}
                </Flex>
              </InnerRow>
            </Flex>
          </Panel>
        </SetupFieldRow>
      ) : null}
    </>
  );
}
