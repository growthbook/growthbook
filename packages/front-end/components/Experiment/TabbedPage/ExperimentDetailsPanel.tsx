import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import DiscussionThread from "@/components/DiscussionThread";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ProjectTagBar from "@/components/Experiment/TabbedPage/ProjectTagBar";
import EditExperimentInfoModal, {
  FocusSelector,
  InfoSection,
} from "@/components/Experiment/TabbedPage/EditExperimentInfoModal";
import { useCustomFields } from "@/hooks/useCustomFields";
import { filterCustomFieldsForSectionAndProject } from "@/services/customFields";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";
import EditHoldoutInfoModal from "@/components/Experiment/TabbedPage/EditHoldoutInfoModal";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import DescriptionField from "@/components/Experiment/TabbedPage/DescriptionField";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import QuickEditButton, { revealsQuickEdit } from "./QuickEditButton";
import AnalysisSummary from "./AnalysisSummary";
import ExpandableBlock from "./ExpandableBlock";
import ExperimentHealthBadges from "./ExperimentHealthBadges";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  isManaged?: boolean;
  mutate: () => void;
  disableEditing?: boolean;
  /** Opens the analysis plan's settings modal, which stages into the page. */
  editAnalysis?: () => void;
}

/** The experiment's metadata and discussion, beside the page rather than above it. */
export default function ExperimentDetailsPanel({
  experiment,
  holdout,
  isManaged,
  mutate,
  disableEditing,
  editAnalysis,
}: Props) {
  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  // Another editing surface cannot open over the page's own unsaved edits, so
  // the controls that would open one say why instead.
  const editsBlocked = useEditsBlockedReason();
  const [focusSelector, setFocusSelector] = useState<FocusSelector>("name");
  const [infoSection, setInfoSection] = useState<InfoSection>("all");
  const [customFieldId, setCustomFieldId] = useState<string | undefined>();
  const editSection = (section: InfoSection) => {
    setInfoSection(section);
    setFocusSelector("name");
    setCustomFieldId(undefined);
    setShowEditInfoModal(true);
  };
  const editCustomField = (id: string) => {
    editSection("customFields");
    setCustomFieldId(id);
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

  // Each field of the General block opens its own quick editor. The key only
  // changes while nothing is serving it.
  const fieldAction = (field: QuickField) => {
    if (field === "trackingKey" && experiment.status !== "draft") return null;
    return pencil(QUICK_FIELD_LABELS[field], () => editSection(field));
  };
  const isHoldout = experiment.type === "holdout";
  // The panel shows these fields in two places: who and what the experiment
  // is, with its description, and how it is set up further down.
  const tagBar = (panel: "about" | "details") => (
    <ProjectTagBar
      panel={panel}
      fieldAction={isHoldout ? undefined : fieldAction}
      experiment={experiment}
      holdout={holdout}
      isManaged={isManaged}
    />
  );
  const { canEdit } = useExperimentEditing(experiment, disableEditing);

  const details = (
    <Flex direction="column" gap="2">
      {tagBar("details")}
      {hasCustomFields ? (
        <ExpandableBlock>
          <CustomFieldDisplay
            rows
            rowAction={(field) =>
              pencil(`Edit ${field.name}`, () => editCustomField(field.id))
            }
            target={experiment}
            canEdit={false}
            mutate={mutate}
            section="experiment"
          />
        </ExpandableBlock>
      ) : null}
    </Flex>
  );

  return (
    <>
      {showEditInfoModal && !isHoldout ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
          focusSelector={focusSelector}
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
          focusSelector={focusSelector}
        />
      ) : null}
      <Tabs
        defaultValue="details"
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
          </TabsList>
        </Flex>
        <TabsContent value="details">
          <Flex px="5" py="4" direction="column" gap="4">
            <Flex direction="column" gap="3">
              {!isHoldout && (
                <DescriptionField
                  stacked
                  experiment={experiment}
                  mutate={mutate}
                  editable={false}
                  labelAction={pencil("Edit description", () =>
                    editSection("description"),
                  )}
                />
              )}
              {tagBar("about")}
              <ExperimentHealthBadges experiment={experiment} />
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
                {details}
              </PanelSection>
            ) : (
              details
            )}
            {/* Bandits and holdouts show their analysis on the page itself. */}
            {!isHoldout && experiment.type !== "multi-armed-bandit" ? (
              <>
                <Separator size="4" />
                <PanelSection
                  title="Analysis"
                  action={
                    canEdit && editAnalysis ? (
                      // Stages into the page's draft, so pending edits don't
                      // block it the way they block the modals that write.
                      <QuickEditButton
                        label="Edit analysis settings"
                        onClick={editAnalysis}
                      />
                    ) : null
                  }
                >
                  <AnalysisSummary experiment={experiment} />
                </PanelSection>
              </>
            ) : null}
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
      </Tabs>
    </>
  );
}

type QuickField = "project" | "trackingKey" | "owner" | "tags";

const QUICK_FIELD_LABELS: Record<QuickField, string> = {
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
