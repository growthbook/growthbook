import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { isActiveDraftStatus } from "shared/validators";
import { QuickEditRow } from "@/components/Experiment/TabbedPage/QuickEditButton";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import ModalWarningBanner from "@/components/Modal/ModalWarningBanner";
import RevisionLabel from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => Promise<unknown> | void;
  setVersion: (version: number) => void;
}

// Soft per-feature draft cap (org setting). Purely advisory: a warning dot and
// tooltip on the button, and a banner to acknowledge in the modal.
function useDraftCap(revisionList: MinimalFeatureRevisionInterface[]) {
  const settings = useOrgSettings();
  const activeDraftCount = revisionList.filter((r) =>
    isActiveDraftStatus(r.status),
  ).length;
  const maxDrafts = settings.maxConcurrentDrafts || 0;
  return {
    activeDraftCount,
    maxDrafts,
    atDraftCap: maxDrafts > 0 && activeDraftCount >= maxDrafts,
  };
}

export default function NewDraftButton(props: Props) {
  const [open, setOpen] = useState(false);
  const { activeDraftCount, maxDrafts, atDraftCap } = useDraftCap(
    props.revisionList,
  );
  return (
    <>
      <Box position="relative">
        <Tooltip
          enabled={atDraftCap}
          content={`This feature has ${activeDraftCount} active draft${
            activeDraftCount === 1 ? "" : "s"
          }, at your organization's cap of ${maxDrafts} per feature. You can still create one after acknowledging the cap.`}
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
      {open ? <NewDraftModal {...props} close={() => setOpen(false)} /> : null}
    </>
  );
}

function NewDraftModal({
  feature,
  revisionList,
  mutate,
  setVersion,
  close,
}: Props & { close: () => void }) {
  const { apiCall } = useAuth();
  const { activeDraftCount, maxDrafts, atDraftCap } = useDraftCap(revisionList);
  const [newDraftTitle, setNewDraftTitle] = useState("");
  const [newDraftTitleStash, setNewDraftTitleStash] = useState("");
  const [editingNewDraftTitle, setEditingNewDraftTitle] = useState(false);
  const [newDraftNotes, setNewDraftNotes] = useState("");
  // An image still uploading would be dropped from the saved description.
  const [uploading, setUploading] = useState(false);
  // Creating past the cap requires acknowledging the banner.
  const [draftCapAcknowledged, setDraftCapAcknowledged] = useState(false);

  const nextVersion = Math.max(0, ...revisionList.map((r) => r.version)) + 1;
  const live = revisionList.find((r) => r.version === feature.version);

  return (
    <ModalStandard
      trackingEventModalType="create-new-draft"
      open={true}
      close={close}
      header="Create New Draft"
      subheader={
        <>
          Based on{" "}
          <Text as="span" size="inherit" weight="semibold" color="text-high">
            <RevisionLabel
              version={feature.version}
              title={live?.title}
              // Untitled, it's already "Revision N".
              numbered={!!live?.title}
              minWidth={0}
              numberSize="inherit"
            />
          </Text>{" "}
          <RevisionStatusBadge revision={live} liveVersion={feature.version} />
        </>
      }
      size="lg"
      cta="Create draft"
      ctaEnabled={(!atDraftCap || draftCapAcknowledged) && !uploading}
      aboveFooterContent={
        atDraftCap ? (
          <ModalWarningBanner
            acknowledged={draftCapAcknowledged}
            setAcknowledged={setDraftCapAcknowledged}
          >
            This feature already has {activeDraftCount} active draft
            {activeDraftCount === 1 ? "" : "s"}; your organization recommends at
            most {maxDrafts}.
          </ModalWarningBanner>
        ) : undefined
      }
      submit={async () => {
        const res = await apiCall<{ draftVersion: number }>(
          `/feature/${feature.id}/draft`,
          {
            method: "POST",
            body: JSON.stringify({
              ...(newDraftTitle.trim() ? { title: newDraftTitle.trim() } : {}),
              ...(newDraftNotes.trim()
                ? { comment: newDraftNotes.trim() }
                : {}),
            }),
          },
        );
        await mutate();
        setVersion(res.draftVersion);
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
