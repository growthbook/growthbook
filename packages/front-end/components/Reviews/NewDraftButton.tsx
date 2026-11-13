import { ReactNode, useState } from "react";
import { Box } from "@radix-ui/themes";
import { QuickEditRow } from "@/components/Experiment/TabbedPage/QuickEditButton";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import Button from "@/ui/Button";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";

export type NewDraftButtonProps = {
  // What the cap message calls the entity, e.g. "Feature Flag".
  entityNoun: string;
  activeDraftCount: number;
  // Soft per-entity draft cap; 0 means none. Purely advisory: a warning dot
  // and tooltip on the button, and a banner to acknowledge in the modal.
  maxDrafts?: number;
  // The revision the draft starts from, named under the modal's header.
  basedOn: ReactNode;
  nextVersion: number;
  create: (draft: { title?: string; comment?: string }) => Promise<void>;
};

export default function NewDraftButton(props: NewDraftButtonProps) {
  const { entityNoun, activeDraftCount, maxDrafts = 0 } = props;
  const [open, setOpen] = useState(false);
  const atDraftCap = maxDrafts > 0 && activeDraftCount >= maxDrafts;
  return (
    <>
      <Box position="relative">
        <Tooltip
          enabled={atDraftCap}
          content={`This ${entityNoun} has ${activeDraftCount} active draft${
            activeDraftCount === 1 ? "" : "s"
          }, at your organization's cap of ${maxDrafts} per ${entityNoun}. You can still create one after acknowledging the cap.`}
        >
          <Button
            onClick={() => setOpen(true)}
            variant="soft"
            style={{ whiteSpace: "nowrap" }}
          >
            New draft
          </Button>
        </Tooltip>
        {atDraftCap && (
          <span
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 10,
              height: 10,
              borderRadius: "50%",
              backgroundColor: "var(--amber-9)",
              border: "2px solid var(--color-panel-solid)",
              pointerEvents: "none",
            }}
          />
        )}
      </Box>
      {open ? (
        <NewDraftModal
          {...props}
          atDraftCap={atDraftCap}
          close={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function NewDraftModal({
  entityNoun,
  activeDraftCount,
  maxDrafts,
  atDraftCap,
  basedOn,
  nextVersion,
  create,
  close,
}: NewDraftButtonProps & { atDraftCap: boolean; close: () => void }) {
  const [newDraftTitle, setNewDraftTitle] = useState("");
  const [newDraftTitleStash, setNewDraftTitleStash] = useState("");
  const [editingNewDraftTitle, setEditingNewDraftTitle] = useState(false);
  const [newDraftNotes, setNewDraftNotes] = useState("");
  // An image still uploading would be dropped from the saved description.
  const [uploading, setUploading] = useState(false);
  // Creating past the cap requires acknowledging the banner.
  const [draftCapAcknowledged, setDraftCapAcknowledged] = useState(false);

  return (
    <ModalStandard
      trackingEventModalType="create-new-draft"
      open={true}
      close={close}
      header="Create New Draft"
      subheader={<>Based on {basedOn}</>}
      size="lg"
      cta="Create draft"
      ctaEnabled={(!atDraftCap || draftCapAcknowledged) && !uploading}
      aboveFooterContent={
        atDraftCap ? (
          <ModalWarningBanner
            acknowledged={draftCapAcknowledged}
            setAcknowledged={setDraftCapAcknowledged}
          >
            This {entityNoun} already has {activeDraftCount} active draft
            {activeDraftCount === 1 ? "" : "s"}; your organization recommends at
            most {maxDrafts}.
          </ModalWarningBanner>
        ) : undefined
      }
      submit={async () => {
        await create({
          ...(newDraftTitle.trim() ? { title: newDraftTitle.trim() } : {}),
          ...(newDraftNotes.trim() ? { comment: newDraftNotes.trim() } : {}),
        });
      }}
    >
      <SetupFieldRow
        label="Name"
        content={editingNewDraftTitle ? "control" : "text"}
      >
        {editingNewDraftTitle ? (
          <TextField
            autoFocus
            value={newDraftTitle}
            placeholder={`Revision ${nextVersion}`}
            onChange={(e) => setNewDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setEditingNewDraftTitle(false);
              } else if (e.key === "Escape") {
                // Reverts the name rather than closing the modal.
                e.preventDefault();
                e.stopPropagation();
                setNewDraftTitle(newDraftTitleStash);
                setEditingNewDraftTitle(false);
              }
            }}
            onBlur={() => setEditingNewDraftTitle(false)}
          />
        ) : (
          <QuickEditRow
            label="Rename draft"
            onEdit={() => {
              setNewDraftTitleStash(newDraftTitle);
              setEditingNewDraftTitle(true);
            }}
          >
            <Text color="text-high">
              {newDraftTitle.trim() || `Revision ${nextVersion}`}
            </Text>
          </QuickEditRow>
        )}
      </SetupFieldRow>
      <SetupFieldRow label="Description">
        <AIRichTextField
          value={newDraftNotes}
          onChange={setNewDraftNotes}
          placeholder="Describe this revision..."
          height="xs"
          collapsibleToolbar
          onUploadingChange={setUploading}
        />
      </SetupFieldRow>
    </ModalStandard>
  );
}
