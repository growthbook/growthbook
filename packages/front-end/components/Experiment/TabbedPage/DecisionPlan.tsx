import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DecisionCriteriaSelectorModal from "@/components/DecisionCriteria/DecisionCriteriaSelectorModal";
import DecisionCriteriaModal from "@/components/DecisionCriteria/DecisionCriteriaModal";
import TargetMDEModal from "@/components/Experiment/TabbedPage/TargetMDEModal";
import EditScheduleModal from "@/components/Experiment/EditScheduleModal";
import {
  percentFormatter,
  useDecisionMakingSummary,
} from "@/components/Experiment/TabbedPage/DecisionMakingSettings";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { useEditsBlockedReason } from "./ExperimentEdits";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import SetupFieldRow from "./SetupFieldRow";

type Editor = "targetMDE" | "criteria" | "schedule";

/**
 * How the experiment's result gets decided: each goal's target MDE, the
 * decision criteria and what happens at the end. Each one writes straight from
 * its own dialog, so they wait while the page holds unsaved edits.
 */
export default function DecisionPlan({
  experiment,
  mutate,
  canEdit,
  envs,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  canEdit: boolean;
  // Environments the experiment reaches; the schedule dialog gates on them.
  envs: string[];
}) {
  const permissionsUtil = usePermissionsUtil();
  const summary = useDecisionMakingSummary(experiment);
  const editsBlocked = useEditsBlockedReason();
  const [editing, setEditing] = useState<Editor | null>(null);
  if (!summary) return null;
  const { goalsWithTargetMDE, decisionCriteria, endSummary, endDetails } =
    summary;

  const editable =
    canEdit && permissionsUtil.canUpdateExperiment(experiment, {});
  const close = () => setEditing(null);
  const saved = () => {
    close();
    mutate();
  };

  const row = (
    label: string,
    tooltip: string,
    editor: Editor,
    value: ReactNode,
    hasValue = true,
  ) => (
    <SetupFieldRow label={label} tooltip={tooltip} content="text">
      <Flex align="start" gap="2" className={revealsQuickEdit}>
        <Box minWidth="0">{value}</Box>
        {editable && hasValue ? (
          <QuickEditButton
            label={`Edit ${label[0].toLowerCase()}${label.slice(1)}`}
            onClick={() => setEditing(editor)}
            blockedReason={editsBlocked}
          />
        ) : null}
      </Flex>
    </SetupFieldRow>
  );

  return (
    <>
      {editing === "criteria" ? (
        editable ? (
          <DecisionCriteriaSelectorModal
            initialCriteria={decisionCriteria}
            experiment={experiment}
            onSubmit={saved}
            onClose={close}
            canEdit
          />
        ) : (
          <DecisionCriteriaModal
            decisionCriteria={decisionCriteria}
            editable={false}
            mutate={() => {}}
            onClose={close}
          />
        )
      ) : null}
      {editing === "targetMDE" ? (
        <TargetMDEModal
          goalsWithTargetMDE={goalsWithTargetMDE}
          experiment={experiment}
          onSubmit={saved}
          onClose={close}
        />
      ) : null}
      {editing === "schedule" ? (
        <EditScheduleModal
          experiment={experiment}
          mutate={mutate}
          envs={envs}
          close={close}
        />
      ) : null}
      <Separator size="4" my="2" />
      <Box py="4">
        <Heading color="text-high" as="h4" size="sm" mb="1">
          Decision-making Settings
        </Heading>

        {row(
          "Target MDE",
          "The smallest effect on each goal metric worth detecting.",
          "targetMDE",
          goalsWithTargetMDE.length ? (
            goalsWithTargetMDE.map((metric) => (
              <Text as="div" color="text-high" key={metric.id}>
                {metric.name} (
                {percentFormatter.format(metric.computedTargetMDE)})
              </Text>
            ))
          ) : (
            <Text color="text-low">
              <em>No goal metrics</em>
            </Text>
          ),
          goalsWithTargetMDE.length > 0,
        )}
        {row(
          "Decision criteria",
          "The rules that turn results into a recommendation to ship, roll back or review.",
          "criteria",
          <Text color="text-high">
            {/* Editors open the rules from the pencil; anyone else from the name. */}
            {editable ? (
              decisionCriteria.name
            ) : (
              <Link onClick={() => setEditing("criteria")}>
                {decisionCriteria.name}
              </Link>
            )}
            {decisionCriteria.description ? (
              <Text color="text-mid">{`: ${decisionCriteria.description}`}</Text>
            ) : null}
          </Text>,
        )}
        {row(
          "End of experiment",
          "What happens when the experiment reaches its scheduled end.",
          "schedule",
          <>
            <Text as="div" color="text-high">
              {endSummary}
            </Text>
            {endDetails.map((detail) => (
              <Text as="div" color="text-mid" key={detail}>
                {detail}
              </Text>
            ))}
          </>,
        )}
      </Box>
    </>
  );
}
