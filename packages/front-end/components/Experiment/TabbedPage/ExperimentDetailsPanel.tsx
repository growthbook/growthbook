import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { isManagedByExperiment } from "shared/util";
import {
  HoldoutInterfaceStringDates,
  type ImplementationType,
} from "shared/validators";
import DiscussionThread from "@/components/DiscussionThread";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ProjectTagBar, {
  QuickEditField,
} from "@/components/Experiment/TabbedPage/ProjectTagBar";
import EditExperimentInfoModal, {
  InfoSection,
} from "@/components/Experiment/TabbedPage/EditExperimentInfoModal";
import { useCustomFields } from "@/hooks/useCustomFields";
import { filterCustomFieldsForSectionAndProject } from "@/services/customFields";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";
import EditHoldoutInfoModal from "@/components/Experiment/TabbedPage/EditHoldoutInfoModal";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import InlineMarkdownField from "@/components/Experiment/TabbedPage/InlineMarkdownField";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  ChecklistCountBadge,
  PreLaunchChecklistPanel,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import ExpandableBlock from "./ExpandableBlock";
import ExperimentHealthBadges from "./ExperimentHealthBadges";

const DETAILS_PANEL_TABS = ["details", "comments", "todo"] as const;
export type DetailsPanelTab = (typeof DETAILS_PANEL_TABS)[number];

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  /** The page's staged implementation type, shown in place of the stored one. */
  stagedImplementationType: ImplementationType | null;
  /** A staged holdout ("" to leave), shown in place of the stored one. */
  stagedHoldoutId?: string | null;
  /** Opens the schedule editor. */
  editSchedule?: (() => void) | null;
  mutate: () => void;
  disableEditing?: boolean;
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
}

/** The experiment's metadata and discussion, beside the page rather than above it. */
export default function ExperimentDetailsPanel({
  experiment,
  holdout,
  linkedFeatures,
  stagedImplementationType,
  stagedHoldoutId = null,
  editSchedule = null,
  mutate,
  disableEditing,
  tab,
  setTab,
}: Props) {
  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  const managedFeature =
    linkedFeatures.find((f) =>
      isManagedByExperiment(f.feature, experiment.id),
    ) ?? null;
  // Another editing surface cannot open over the page's own unsaved edits, so
  // the controls that would open one say why instead.
  const editsBlocked = useEditsBlockedReason();
  const { canEdit } = useExperimentEditing(experiment, disableEditing);
  const [infoSection, setInfoSection] = useState<InfoSection>("all");
  const [customFieldId, setCustomFieldId] = useState<string | null>(null);
  const editSection = (section: InfoSection, fieldId: string | null = null) => {
    setInfoSection(section);
    setCustomFieldId(fieldId);
    setShowEditInfoModal(true);
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
      />
    ) : null;

  // The key only changes while nothing is serving it.
  const fieldAction = (field: QuickEditField) => {
    if (field === "trackingKey" && experiment.status !== "draft") return null;
    return pencil(QUICK_FIELD_LABELS[field], () => editSection(field));
  };
  const isHoldout = experiment.type === "holdout";
  const tagBar = (panel: "about" | "details") => (
    <ProjectTagBar
      panel={panel}
      fieldAction={isHoldout ? undefined : fieldAction}
      experiment={experiment}
      holdout={holdout}
      managedFlagId={managedFeature?.feature.id ?? null}
      stagedImplementationType={stagedImplementationType}
      stagedHoldoutId={stagedHoldoutId}
      editSchedule={canEdit ? editSchedule : null}
    />
  );
  const {
    active: checklistActive,
    checklistItemsRemaining,
    checklistHardBlockerCount,
  } = usePreLaunchChecklist();
  const showTodo = checklistActive && !experiment.archived;
  // Once it starts, a draft's To Do tab is gone.
  const shownTab = tab === "todo" && !showTodo ? "details" : tab;

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
      {showEditInfoModal && !isHoldout ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
          section={infoSection}
          customFieldId={customFieldId}
        />
      ) : null}
      {showEditInfoModal && isHoldout && holdout ? (
        <EditHoldoutInfoModal
          experiment={experiment}
          holdout={holdout}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
        />
      ) : null}
      <Tabs
        value={shownTab}
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
        <Flex px="5" pt="2" align="center" gap="2">
          <TabsList size="sm" style={{ flex: 1, minWidth: 0 }}>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="comments">Comments</TabsTrigger>
            {showTodo && (
              <TabsTrigger value="todo">
                <Flex as="span" align="center" gap="2">
                  To Do
                  <ChecklistCountBadge
                    remaining={checklistItemsRemaining}
                    blocking={checklistHardBlockerCount > 0}
                  />
                </Flex>
              </TabsTrigger>
            )}
          </TabsList>
        </Flex>
        <TabsContent value="details">
          <Flex px="5" py="4" direction="column" gap="4">
            <Flex direction="column" gap="3">
              {!isHoldout && (
                <InlineMarkdownField
                  label="Description"
                  field="description"
                  stacked
                  experiment={experiment}
                  editable={false}
                  labelAction={pencil("Edit description", () =>
                    editSection("description"),
                  )}
                />
              )}
              {tagBar("about")}
              <ExperimentHealthBadges experiment={experiment} />
              {customFieldRows}
            </Flex>
            <Separator size="4" />
            {/* Holdouts edit all of this at once, so they keep a heading
                for the button; elsewhere each field has its own. */}
            {isHoldout ? (
              <PanelSection
                title="General"
                action={pencil("Edit details", () =>
                  setShowEditInfoModal(true),
                )}
              >
                {tagBar("details")}
              </PanelSection>
            ) : (
              tagBar("details")
            )}
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
          <Box
            px="5"
            pt="4"
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
          </Box>
        </TabsContent>
        {showTodo && (
          <TabsContent value="todo">
            <Flex px="5" py="4" direction="column" gap="4">
              <PreLaunchChecklistPanel />
            </Flex>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

const QUICK_FIELD_LABELS: Record<QuickEditField, string> = {
  project: "Edit project",
  trackingKey: "Edit experiment key",
  owner: "Edit owner",
  tags: "Edit tags",
};

/** A titled block of the panel, with the button that edits it. */
function PanelSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Flex
      direction="column"
      gap="3"
      className={action ? revealsQuickEdit : undefined}
    >
      <Flex align="center" gap="1">
        <Text
          size="sm"
          weight="medium"
          color="text-low"
          textTransform="uppercase"
        >
          {title}
        </Text>
        {action}
      </Flex>
      {children}
    </Flex>
  );
}
