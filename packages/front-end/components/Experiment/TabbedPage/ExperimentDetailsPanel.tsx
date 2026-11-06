import { useState } from "react";
import { hasPendingScheduledStart } from "shared/util";
import { Box, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import DetailsPanel, {
  DetailsPanelTab,
  PanelSection,
} from "@/components/DetailsPanel";
import {
  CustomFieldRows,
  PanelEditButton,
} from "@/components/DetailsPanelFields";
import ProjectTagBar, {
  ExperimentDataFields,
  QuickEditField,
} from "@/components/Experiment/TabbedPage/ProjectTagBar";
import EditExperimentInfoModal, {
  InfoSection,
  SECTION_HEADERS,
} from "@/components/Experiment/TabbedPage/EditExperimentInfoModal";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  PreLaunchChecklistPanel,
  todoTitle,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import Metadata from "@/ui/Metadata";
import { headerDates } from "./statusSchedule";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  datasourceMissing?: boolean;
  holdout?: HoldoutInterfaceStringDates;
  stagedHoldoutId?: string | null;
  mutate: () => void;
  disableEditing?: boolean;
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
}

export default function ExperimentDetailsPanel({
  experiment,
  datasourceMissing = false,
  holdout,
  stagedHoldoutId = null,
  mutate,
  disableEditing,
  tab,
  setTab,
}: Props) {
  // Editors can't open over the page's unsaved edits; their buttons say why.
  const editsBlocked = useEditsBlockedReason();
  const { canEdit } = useExperimentEditing(experiment, disableEditing, holdout);
  const [infoSection, setInfoSection] = useState<InfoSection | null>(null);
  const [customFieldId, setCustomFieldId] = useState<string | null>(null);
  const editSection = (section: InfoSection, fieldId: string | null = null) => {
    setInfoSection(section);
    setCustomFieldId(fieldId);
  };

  const pencil = (label: string, onClick: () => void) => (
    <PanelEditButton
      canEdit={canEdit}
      label={label}
      onClick={onClick}
      blockedReason={editsBlocked}
    />
  );

  const fieldAction = (field: QuickEditField) => {
    // The key only changes while nothing is serving it, or about to.
    if (
      field === "trackingKey" &&
      (experiment.status !== "draft" || hasPendingScheduledStart(experiment))
    ) {
      return null;
    }
    return pencil(SECTION_HEADERS[field], () => editSection(field));
  };
  const { active: checklistActive, checklistItemsRemaining } =
    usePreLaunchChecklist();
  const showTodo = checklistActive && !experiment.archived;

  return (
    <>
      {infoSection ? (
        <EditExperimentInfoModal
          experiment={experiment}
          holdout={holdout}
          setShowEditInfoModal={() => setInfoSection(null)}
          mutate={mutate}
          section={infoSection}
          customFieldId={customFieldId}
        />
      ) : null}
      <DetailsPanel
        tab={tab}
        setTab={setTab}
        discussion={{
          type: "experiment",
          id: experiment.id,
          projects: experiment.project ? [experiment.project] : [],
          allowNewComments: !experiment.archived,
        }}
      >
        {showTodo ? (
          <>
            <PanelSection title={todoTitle(checklistItemsRemaining)}>
              <PreLaunchChecklistPanel />
            </PanelSection>
            {/* Runs edge to edge, past the rail's padding. */}
            <Box mx="-5">
              <Separator size="4" />
            </Box>
          </>
        ) : null}
        <PanelSection title="General">
          <ProjectTagBar
            experiment={experiment}
            holdout={holdout}
            fieldAction={fieldAction}
          />
          {/* The header's dates, which a phase selector stands in for
              there. */}
          {headerDates(experiment, new Date()).map(({ label, value }) => (
            <Metadata
              key={label}
              size="sm"
              stacked
              label={label}
              value={value}
            />
          ))}
          <CustomFieldRows
            section="experiment"
            target={experiment}
            action={(field) =>
              pencil(`Edit ${field.name}`, () =>
                editSection("customFields", field.id),
              )
            }
          />
        </PanelSection>
        <Separator size="4" />
        <PanelSection title="Data">
          <ExperimentDataFields
            experiment={experiment}
            datasourceMissing={datasourceMissing}
            stagedHoldoutId={stagedHoldoutId}
            fieldAction={fieldAction}
          />
        </PanelSection>
      </DetailsPanel>
    </>
  );
}
