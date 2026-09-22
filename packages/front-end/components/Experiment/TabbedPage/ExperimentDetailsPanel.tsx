import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { HoldoutInterfaceStringDates } from "shared/validators";
import DiscussionThread from "@/components/DiscussionThread";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import ProjectTagBar from "@/components/Experiment/TabbedPage/ProjectTagBar";
import EditExperimentInfoModal, {
  FocusSelector,
} from "@/components/Experiment/TabbedPage/EditExperimentInfoModal";
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
  const isHoldout = experiment.type === "holdout";
  const { canEdit, editInline } = useExperimentEditing(
    experiment,
    disableEditing,
  );

  return (
    <>
      {showEditInfoModal && !isHoldout ? (
        <EditExperimentInfoModal
          experiment={experiment}
          setShowEditInfoModal={setShowEditInfoModal}
          mutate={mutate}
          focusSelector={focusSelector}
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
          {canEdit ? (
            <Tooltip content={editsBlocked ?? "Edit details"}>
              <IconButton
                size="1"
                variant="ghost"
                color="violet"
                radius="medium"
                disabled={!!editsBlocked}
                aria-label="Edit details"
                style={{
                  margin: 0,
                  padding: 0,
                  width: "var(--space-5)",
                  height: "var(--space-5)",
                }}
                onClick={() => {
                  setFocusSelector("name");
                  setShowEditInfoModal(true);
                }}
              >
                <PiPencilSimple size={16} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Flex>
        <TabsContent value="details">
          <Flex px="5" py="4" direction="column" gap="4">
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
            {!isHoldout && (
              <DescriptionField
                stacked
                experiment={experiment}
                mutate={mutate}
                editable={false}
              />
            )}
            <CustomFieldDisplay
              stacked
              target={experiment}
              canEdit={canEdit}
              mutate={mutate}
              section="experiment"
              collapseWhenEmpty={editInline}
            />
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
