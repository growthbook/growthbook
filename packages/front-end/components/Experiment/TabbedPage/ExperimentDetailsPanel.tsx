import { ReactNode, useState } from "react";
import { Box, Flex, IconButton, Separator } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
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
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import EditHoldoutInfoModal from "@/components/Experiment/TabbedPage/EditHoldoutInfoModal";
import CustomFieldDisplay from "@/components/CustomFields/CustomFieldDisplay";
import DescriptionField from "@/components/Experiment/TabbedPage/DescriptionField";
import useExperimentEditing from "@/components/Experiment/TabbedPage/useExperimentEditing";
import { useEditsBlockedReason } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import Tooltip from "@/ui/Tooltip";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterfaceStringDates;
  isManaged?: boolean;
  mutate: () => void;
  editTags?: (() => void) | null;
  disableEditing?: boolean;
}

/** The experiment's metadata and discussion, beside the page rather than above it. */
export default function ExperimentDetailsPanel({
  experiment,
  holdout,
  isManaged,
  mutate,
  editTags,
  disableEditing,
}: Props) {
  const [showEditInfoModal, setShowEditInfoModal] = useState(false);
  // Another editing surface cannot open over the page's own unsaved edits, so
  // the controls that would open one say why instead.
  const editsBlocked = useEditsBlockedReason();
  const [focusSelector, setFocusSelector] = useState<FocusSelector>("name");
  const [infoSection, setInfoSection] = useState<InfoSection>("all");
  const editSection = (section: InfoSection) => {
    setInfoSection(section);
    setFocusSelector("name");
    setShowEditInfoModal(true);
  };

  const statusIndicator = useExperimentStatusIndicator()(experiment);
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
      <Tooltip content={editsBlocked ?? label}>
        <IconButton
          size="1"
          variant="ghost"
          color="violet"
          radius="medium"
          disabled={!!editsBlocked}
          aria-label={label}
          style={{ margin: 0 }}
          onClick={onClick}
        >
          <PiPencilSimple size={14} />
        </IconButton>
      </Tooltip>
    ) : null;
  const isHoldout = experiment.type === "holdout";
  const { canEdit } = useExperimentEditing(experiment, disableEditing);

  return (
    <>
      {showEditInfoModal && !isHoldout ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
          focusSelector={focusSelector}
          section={infoSection}
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
            <Metadata
              size="sm"
              stacked
              label="Status"
              value={
                <Text size="sm" color="text-high">
                  {statusIndicator.status}
                  {statusIndicator.detailedStatus ? (
                    <Text color="text-mid">
                      {" "}
                      · {statusIndicator.detailedStatus}
                    </Text>
                  ) : null}
                </Text>
              }
            />
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
            <Separator size="4" />
            <PanelSection
              title="General"
              action={pencil("Edit details", () =>
                isHoldout ? setShowEditInfoModal(true) : editSection("general"),
              )}
            >
              <ProjectTagBar
                vertical
                experiment={experiment}
                holdout={holdout}
                setShowEditInfoModal={setShowEditInfoModal}
                setEditInfoFocusSelector={setFocusSelector}
                editTags={editTags}
                editsBlockedReason={editsBlocked}
                isManaged={isManaged}
              />
            </PanelSection>
            {hasCustomFields ? (
              <>
                <Separator size="4" />
                <PanelSection
                  title="Additional fields"
                  action={pencil("Edit additional fields", () =>
                    editSection("customFields"),
                  )}
                >
                  <CustomFieldDisplay
                    stacked
                    target={experiment}
                    canEdit={false}
                    mutate={mutate}
                    section="experiment"
                  />
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
    <Flex direction="column" gap="4">
      <Flex align="center" justify="between" gap="2">
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
