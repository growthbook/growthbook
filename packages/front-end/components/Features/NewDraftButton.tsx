import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimpleFill, PiPlus } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
// eslint-disable-next-line no-restricted-imports -- legacy Modal still backs the new-draft modal; migrate to @/ui/Modal in a follow-up
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Reviews/RevisionLabel";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => Promise<unknown> | void;
  setVersion: (version: number) => void;
}

// Soft per-feature draft cap (org setting). Purely advisory: a warning dot and
// tooltip on the button, and a callout in the modal; creating is never blocked.
function useDraftCap(revisionList: MinimalFeatureRevisionInterface[]) {
  const settings = useOrgSettings();
  const activeDraftCount = revisionList.filter((r) =>
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
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
            New Draft
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
  const [showNewDraftNotes, setShowNewDraftNotes] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  // Creating past the cap requires ticking the checkbox in its callout.
  const [draftCapAcknowledged, setDraftCapAcknowledged] = useState(false);

  return (
    <Modal
      trackingEventModalType="create-new-draft"
      open={true}
      close={close}
      header="Create New Draft"
      cta="Create Draft"
      ctaEnabled={!atDraftCap || draftCapAcknowledged}
      disabledMessage="Acknowledge the draft cap warning to continue"
      loading={creatingDraft}
      submit={async () => {
        setCreatingDraft(true);
        try {
          const res = await apiCall<{ draftVersion: number }>(
            `/feature/${feature.id}/draft`,
            {
              method: "POST",
              body: JSON.stringify({
                ...(newDraftTitle.trim()
                  ? { title: newDraftTitle.trim() }
                  : {}),
                ...(newDraftNotes.trim()
                  ? { comment: newDraftNotes.trim() }
                  : {}),
              }),
            },
          );
          await mutate();
          setVersion(res.draftVersion);
        } finally {
          setCreatingDraft(false);
        }
      }}
    >
      <Flex direction="column" gap="2">
        {atDraftCap && (
          <Callout status="warning" mb="2">
            <Flex direction="column" gap="2" align="start">
              <Text>
                This feature already has {activeDraftCount} active draft
                {activeDraftCount === 1 ? "" : "s"} — your organization
                recommends keeping it to {maxDrafts} per feature.
              </Text>
              <Checkbox
                id="acknowledge-draft-cap"
                label="Acknowledge and override"
                weight="regular"
                value={draftCapAcknowledged}
                setValue={setDraftCapAcknowledged}
              />
            </Flex>
          </Callout>
        )}
        <Text>
          Creating a <Text weight="semibold">new draft</Text> based on{" "}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-1)",
              whiteSpace: "nowrap",
              backgroundColor: "var(--gray-a2)",
              padding: "1px 4px",
              margin: "2px",
              borderRadius: "var(--radius-2)",
            }}
          >
            <Text as="span" size="md" weight="semibold" color="text-high">
              <OverflowText
                maxWidth={200}
                title={revisionLabelText(
                  feature.version,
                  revisionList.find((r) => r.version === feature.version)
                    ?.title,
                )}
              >
                <RevisionLabel
                  version={feature.version}
                  title={
                    revisionList.find((r) => r.version === feature.version)
                      ?.title
                  }
                  minWidth={0}
                />
              </OverflowText>
            </Text>
            <RevisionStatusBadge
              revision={revisionList.find((r) => r.version === feature.version)}
              liveVersion={feature.version}
            />
          </span>
        </Text>
        <Box my="3">
          <Flex align="center" gap="2">
            {newDraftTitle.trim() && !editingNewDraftTitle && (
              <span
                style={{
                  display: "inline-block",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                <Text as="span" color="text-mid" size="sm">
                  {Math.max(0, ...revisionList.map((r) => r.version)) + 1}.
                </Text>
              </span>
            )}
            {editingNewDraftTitle ? (
              <Field
                autoFocus
                value={newDraftTitle}
                placeholder={`Revision ${Math.max(0, ...revisionList.map((r) => r.version)) + 1}`}
                onChange={(e) => setNewDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setEditingNewDraftTitle(false);
                  } else if (e.key === "Escape") {
                    setNewDraftTitle(newDraftTitleStash);
                    setEditingNewDraftTitle(false);
                  }
                }}
                onBlur={() => setEditingNewDraftTitle(false)}
                containerStyle={{ maxWidth: 250, marginBottom: 0 }}
                style={{
                  border: "none",
                  borderBottom: "1px solid var(--violet-9)",
                  borderRadius: 0,
                  outline: "none",
                  background: "transparent",
                  boxShadow: "none",
                  padding: "0 2px",
                  height: "auto",
                }}
              />
            ) : (
              <Text weight="semibold">
                <RevisionLabel
                  version={
                    Math.max(0, ...revisionList.map((r) => r.version)) + 1
                  }
                  title={newDraftTitle.trim() || null}
                  numbered={false}
                />
              </Text>
            )}
            {!editingNewDraftTitle && (
              <IconButton
                type="button"
                variant="ghost"
                color="violet"
                size="2"
                radius="full"
                onClick={() => {
                  setNewDraftTitleStash(newDraftTitle);
                  setEditingNewDraftTitle(true);
                }}
                mx="1"
              >
                <PiPencilSimpleFill />
              </IconButton>
            )}
          </Flex>
        </Box>
        {showNewDraftNotes ? (
          <Field
            label="Description"
            labelClassName="font-weight-bold"
            textarea
            value={newDraftNotes}
            onChange={(e) => setNewDraftNotes(e.target.value)}
          />
        ) : (
          <Link
            onClick={(e) => {
              e.preventDefault();
              setShowNewDraftNotes(true);
            }}
          >
            <Flex align="center" gap="1" mb="3">
              <PiPlus />
              <Text weight="medium">Add description</Text>
            </Flex>
          </Link>
        )}
      </Flex>
    </Modal>
  );
}
