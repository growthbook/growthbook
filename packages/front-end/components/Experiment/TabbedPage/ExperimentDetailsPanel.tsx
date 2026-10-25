import { ReactNode, useState } from "react";
import { hasPendingScheduledStart } from "shared/util";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import DiscussionThread from "@/components/DiscussionThread";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ScrollArea from "@/ui/ScrollArea";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import ProjectTagBar, {
  EmptyValue,
  ExperimentDataFields,
  QuickEditField,
} from "@/components/Experiment/TabbedPage/ProjectTagBar";
import EditExperimentInfoModal, {
  InfoSection,
  SECTION_HEADERS,
} from "@/components/Experiment/TabbedPage/EditExperimentInfoModal";
import { useCustomFields } from "@/hooks/useCustomFields";
import { filterCustomFieldsForSectionAndProject } from "@/services/customFields";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";
import Metadata from "@/ui/Metadata";
import Markdown from "@/components/Markdown/Markdown";
import EditHoldoutInfoModal from "@/components/Experiment/TabbedPage/EditHoldoutInfoModal";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  PreLaunchChecklistPanel,
  todoTitle,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import ExpandableBlock from "./ExpandableBlock";
import ExperimentHealthBadges from "./ExperimentHealthBadges";

const DETAILS_PANEL_TABS = ["details", "comments"] as const;
export type DetailsPanelTab = (typeof DETAILS_PANEL_TABS)[number];

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  stagedHoldoutId?: string | null;
  editSchedule?: (() => void) | null;
  mutate: () => void;
  disableEditing?: boolean;
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
}

export default function ExperimentDetailsPanel({
  experiment,
  holdout,
  stagedHoldoutId = null,
  editSchedule = null,
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
  const [editingHoldout, setEditingHoldout] = useState(false);
  const editSection = (section: InfoSection, fieldId: string | null = null) => {
    setInfoSection(section);
    setCustomFieldId(fieldId);
  };

  const { hasCommercialFeature } = useUser();
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    "experiment",
    experiment.project,
  );
  const hasCustomFields =
    hasCommercialFeature("custom-metadata") && !!customFields?.length;

  const pencil = (label: string, onClick: () => void) =>
    canEdit ? (
      <QuickEditButton
        label={label}
        onClick={onClick}
        blockedReason={editsBlocked}
        labelTooltip={false}
      />
    ) : null;

  const fieldAction = (field: QuickEditField) => {
    if (field === "schedule") {
      return editSchedule ? pencil("Edit schedule", editSchedule) : null;
    }
    // The key only changes while nothing is serving it, or about to.
    if (
      field === "trackingKey" &&
      (experiment.status !== "draft" || hasPendingScheduledStart(experiment))
    ) {
      return null;
    }
    return pencil(SECTION_HEADERS[field], () => editSection(field));
  };
  const isHoldout = experiment.type === "holdout";
  const rowAction = isHoldout ? null : fieldAction;
  const { active: checklistActive, checklistItemsRemaining } =
    usePreLaunchChecklist();
  const showTodo = checklistActive && !experiment.archived;

  const customFieldRows = hasCustomFields ? (
    <ExpandableBlock>
      <CustomFieldDisplay
        rows
        rowAction={(field) =>
          pencil(`Edit ${field.name}`, () =>
            editSection("customFields", field.id),
          )
        }
        target={experiment}
        canEdit={false}
        mutate={mutate}
        section="experiment"
      />
    </ExpandableBlock>
  ) : null;

  return (
    <>
      {infoSection ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={() => setInfoSection(null)}
          mutate={mutate}
          section={infoSection}
          customFieldId={customFieldId}
        />
      ) : null}
      {editingHoldout && holdout ? (
        <EditHoldoutInfoModal
          experiment={experiment}
          holdout={holdout}
          setShowEditInfoModal={setEditingHoldout}
          mutate={mutate}
        />
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = DETAILS_PANEL_TABS.find((t) => t === value);
          if (next) setTab(next);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Above the scroll area, so it and the scrollbar start under it. */}
        <Flex pt="2" align="center" gap="2" flexShrink="0">
          {/* Padded inside, so its underline runs the rail's full width. */}
          <TabsList
            size="sm"
            style={{
              flex: 1,
              minWidth: 0,
              paddingInline: "var(--space-5)",
            }}
          >
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="comments">Comments</TabsTrigger>
          </TabsList>
        </Flex>
        <ScrollArea fill style={{ flex: 1, minHeight: 0 }}>
          <TabsContent value="details">
            <Flex px="5" py="4" direction="column" gap="4">
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
              {/* A holdout's name, owner, tags and projects edit together;
                  every other field has its own button. */}
              <PanelSection
                title="General"
                action={
                  isHoldout
                    ? pencil("Edit details", () => setEditingHoldout(true))
                    : null
                }
              >
                <Flex direction="column" gap="3">
                  <Metadata
                    size="sm"
                    stacked
                    label="Description"
                    action={pencil("Edit description", () =>
                      editSection("description"),
                    )}
                    value={
                      <Box width="100%">
                        {experiment.description ? (
                          // Beside the page rather than on it, so it reads at
                          // the column's size, and a long one doesn't push
                          // the rest of the column away.
                          <ExpandableBlock>
                            <Box style={{ fontSize: "var(--font-size-1)" }}>
                              <Markdown>{experiment.description}</Markdown>
                            </Box>
                          </ExpandableBlock>
                        ) : (
                          <EmptyValue />
                        )}
                      </Box>
                    }
                  />
                  <ProjectTagBar
                    experiment={experiment}
                    holdout={holdout}
                    fieldAction={rowAction}
                  />
                  <ExperimentHealthBadges experiment={experiment} />
                  {customFieldRows}
                </Flex>
              </PanelSection>
              <Separator size="4" />
              <PanelSection title="Data">
                <ExperimentDataFields
                  experiment={experiment}
                  stagedHoldoutId={stagedHoldoutId}
                  fieldAction={rowAction}
                />
              </PanelSection>
            </Flex>
          </TabsContent>
          <TabsContent
            value="comments"
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            <DiscussionThread
              compact
              fillHeight
              type="experiment"
              id={experiment.id}
              allowNewComments={!experiment.archived}
              projects={experiment.project ? [experiment.project] : []}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </>
  );
}

function PanelSection({
  title,
  action = null,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Box className={action ? revealsQuickEdit : undefined}>
      <CollapseTrigger open={open} onOpenChange={setOpen} action={action}>
        <Text
          size="sm"
          weight="medium"
          color="text-low"
          textTransform="uppercase"
        >
          {title}
        </Text>
      </CollapseTrigger>
      <Collapse open={open}>
        <Box pt="4">{children}</Box>
      </Collapse>
    </Box>
  );
}
