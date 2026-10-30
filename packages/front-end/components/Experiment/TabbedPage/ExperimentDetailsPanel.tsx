import { ReactNode, useState } from "react";
import { hasPendingScheduledStart } from "shared/util";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import { DiscussionInterface } from "shared/types/discussion";
import {
  ExperimentQualityScoreResult,
  getQualityImprovements,
} from "shared/enterprise";
import DiscussionThread from "@/components/DiscussionThread";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ScrollArea from "@/ui/ScrollArea";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import ProjectTagBar, {
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
import Badge from "@/ui/Badge";
import useApi from "@/hooks/useApi";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import { usePreLaunchChecklist } from "@/components/PreLaunchChecklist/PreLaunchChecklistProvider";
import {
  PreLaunchChecklistPanel,
  todoTitle,
} from "@/components/PreLaunchChecklist/PreLaunchChecklist";
import Metadata from "@/ui/Metadata";
import QualityPanel from "@/components/Experiment/Quality/QualityPanel";
import { QualityFixTargets } from "@/components/Experiment/Quality/qualityFixes";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import { headerDates } from "./statusSchedule";
import ExpandableBlock from "./ExpandableBlock";

const DETAILS_PANEL_TABS = ["details", "comments", "quality"] as const;
export type DetailsPanelTab = (typeof DETAILS_PANEL_TABS)[number];

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  datasourceMissing?: boolean;
  holdout?: HoldoutInterfaceStringDates;
  stagedHoldoutId?: string | null;
  mutate: () => void;
  disableEditing?: boolean;
  tab: DetailsPanelTab;
  setTab: (tab: DetailsPanelTab) => void;
  // Null when quality scoring is off for the experiment
  quality?: {
    result: ExperimentQualityScoreResult;
    targets: QualityFixTargets;
    implementationId: string;
  } | null;
}

export default function ExperimentDetailsPanel({
  experiment,
  datasourceMissing = false,
  holdout,
  stagedHoldoutId = null,
  mutate,
  disableEditing,
  tab: requestedTab,
  setTab,
  quality = null,
}: Props) {
  const tab = requestedTab === "quality" && !quality ? "details" : requestedTab;
  const qualityFixCount =
    quality && experiment.status === "draft"
      ? getQualityImprovements(quality.result).length
      : 0;
  // Editors can't open over the page's unsaved edits; their buttons say why.
  const editsBlocked = useEditsBlockedReason();
  const { canEdit } = useExperimentEditing(experiment, disableEditing, holdout);
  const [infoSection, setInfoSection] = useState<InfoSection | null>(null);
  const [customFieldId, setCustomFieldId] = useState<string | null>(null);
  // The thread's own request, so a new comment updates the count too.
  const { data: discussionData } = useApi<{
    discussion: DiscussionInterface;
  }>(`/discussion/experiment/${experiment.id}`);
  const commentCount = discussionData?.discussion?.comments?.length ?? 0;
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
          holdout={holdout}
          setShowEditInfoModal={() => setInfoSection(null)}
          mutate={mutate}
          section={infoSection}
          customFieldId={customFieldId}
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
          {/* Padded inside, so its underline runs the rail's full width; less
              its tabs' own padding, so the first label lines up with the
              rail's content. */}
          <TabsList
            size="sm"
            style={{
              flex: 1,
              minWidth: 0,
              paddingInline: "calc(var(--space-5) - 2 * var(--space-1))",
            }}
          >
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="comments">
              Comments
              {commentCount > 0 && (
                <Badge
                  label={commentCount.toString()}
                  size="xs"
                  color="gray"
                  variant="soft"
                  radius="full"
                  ml="1"
                />
              )}
            </TabsTrigger>
            {quality ? (
              <TabsTrigger value="quality">
                Quality
                {quality.result.score !== null &&
                experiment.status !== "draft" ? (
                  <span
                    style={{
                      marginLeft: "var(--space-1)",
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--gray-11)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {quality.result.score}
                  </span>
                ) : null}
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Flex>
        <ScrollArea fill style={{ flex: 1, minHeight: 0 }}>
          <TabsContent value="details">
            <Flex px="5" py="4" direction="column" gap="4">
              {showTodo ? (
                <>
                  <PanelSection title={todoTitle(checklistItemsRemaining)}>
                    <PreLaunchChecklistPanel
                      extraItems={
                        qualityFixCount
                          ? [
                              {
                                key: "improve-quality",
                                display: `Improve quality (${qualityFixCount})`,
                                action: { onClick: () => setTab("quality") },
                                status: "incomplete",
                                type: "manual",
                                required: false,
                              },
                            ]
                          : []
                      }
                    />
                  </PanelSection>
                  {/* Runs edge to edge, past the rail's padding. */}
                  <Box mx="-5">
                    <Separator size="4" />
                  </Box>
                </>
              ) : null}
              <PanelSection title="General">
                <Flex direction="column" gap="3">
                  <ProjectTagBar
                    experiment={experiment}
                    holdout={holdout}
                    fieldAction={fieldAction}
                  />
                  {/* The header's dates, which a phase selector stands in for
                      there. */}
                  {headerDates(experiment, new Date()).map(
                    ({ label, value }) => (
                      <Metadata
                        key={label}
                        size="sm"
                        stacked
                        label={label}
                        value={value}
                      />
                    ),
                  )}
                  {customFieldRows}
                </Flex>
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
          {quality ? (
            <TabsContent value="quality">
              <QualityPanel
                experiment={experiment}
                result={quality.result}
                mutate={mutate}
                targets={quality.targets}
                implementationId={quality.implementationId}
              />
            </TabsContent>
          ) : null}
        </ScrollArea>
      </Tabs>
    </>
  );
}

export function PanelSection({
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
