import { useState } from "react";
import pick from "lodash/pick";
import { Box, Flex } from "@radix-ui/themes";
import { Revision, getRevisionNumberById } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import StagedEditsBar from "@/components/StagedEdits/StagedEditsBar";
import {
  StagedChange,
  StagedChangesPopover,
} from "@/components/StagedEdits/StagedChanges";
import { revisionLabelText } from "@/components/Reviews/RevisionLabel";
import SelectField from "@/components/Forms/SelectField";
import {
  changedKeys,
  sdkConnectionBody,
} from "@/components/Features/SDKConnections/SDKConnectionEditModal";
import {
  isDraftRevision,
  saveSdkConnectionChanges,
} from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";
import { SdkConnectionStagedEdits } from "@/components/Features/SDKConnections/useSdkConnectionStagedEdits";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { ApiCallError } from "@/services/apiCallError";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

const NEW_DRAFT = "new";

// The page's staged edits and where they're saved: the viewed draft, or, from
// live, an open draft or a new one that's created on save.
export default function SDKConnectionEditsBar({
  connection,
  staged,
  draft,
  openRevisions,
  allRevisions,
  onRevisionCreated,
  onSelectRevision,
  mutate,
}: {
  // As viewed: the selected draft's changes over live.
  connection: SDKConnectionInterface;
  staged: SdkConnectionStagedEdits;
  // The draft being viewed, which the edits save to.
  draft: Revision | null;
  openRevisions: Revision[];
  allRevisions: Revision[];
  onRevisionCreated: (revision: Revision) => void;
  onSelectRevision: (revision: Revision | null) => void;
  mutate: () => Promise<unknown>;
}) {
  const { apiCall } = useAuth();
  const numbers = getRevisionNumberById(allRevisions);
  // Newest first, as the revision selector lists them.
  const drafts = openRevisions
    .filter(isDraftRevision)
    .sort((a, b) => (numbers.get(b.id) ?? 0) - (numbers.get(a.id) ?? 0));
  const [chosen, setChosen] = useState<string | null>(null);
  // Your own newest draft unless another was picked, and a new one if you
  // have none: a teammate's draft, which may be approved, is theirs to offer.
  const { user } = useUser();
  const target =
    chosen && (chosen === NEW_DRAFT || drafts.some((d) => d.id === chosen))
      ? chosen
      : (drafts.find((d) => d.authorId === user?.id)?.id ?? NEW_DRAFT);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown once a save is tried, and only while it still applies.
  const [triedSave, setTriedSave] = useState(false);
  const invalid = triedSave ? staged.invalidReason : null;

  const save = async () => {
    const body = sdkConnectionBody(staged.shown);
    const keys = changedKeys(sdkConnectionBody(staged.saved), body);
    if (!keys.length) {
      staged.clear();
      return;
    }
    if (staged.invalidReason) {
      setError(null);
      setTriedSave(true);
      return;
    }
    // What someone else saved since is kept or dropped first, on its row.
    if (staged.hasConflicts) {
      setOpen(true);
      return;
    }
    const draftId = draft ? draft.id : target === NEW_DRAFT ? null : target;
    setSaving(true);
    setError(null);
    let landed = false;
    try {
      await saveSdkConnectionChanges({
        apiCall,
        connection,
        body: pick(body, keys),
        // Checked against what the edits land on: the viewed draft or live.
        // Another draft picked from live has its own values, so it isn't.
        expected:
          draft || !draftId
            ? pick(sdkConnectionBody(staged.based), keys)
            : undefined,
        mode: draftId ? "existing" : "new",
        draftId,
        bypassApproval: false,
        // Cleared before the view moves to the draft, while the edits are
        // still the ones on screen.
        onRevisionCreated: (revision) => {
          landed = true;
          staged.clear();
          setOpen(false);
          onRevisionCreated(revision);
        },
        onSelectRevision,
        mutate,
      });
      // A save the server finds unchanged returns no revision and stays put.
      // After a landing, `clear` would reach the draft now in view.
      if (!landed) {
        staged.clear();
        setOpen(false);
      }
    } catch (e) {
      // Someone saved first: reload what they saved, and the rows show it.
      if (e instanceof ApiCallError && e.code === "changes_conflict") {
        await mutate();
        setOpen(true);
      } else {
        setError(e instanceof Error ? e.message : "The changes weren't saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <StagedEditsBar
      columnClassName="details-column"
      changes={
        <StagedChangesPopover
          open={open}
          onOpenChange={setOpen}
          count={staged.stagedRows.length}
        >
          {staged.stagedRows.map((row) => (
            <StagedChange
              key={row.key}
              label={row.label}
              review={{
                before: pick(staged.saved, staged.fieldsOf(row)),
                after: pick(staged.shown, staged.fieldsOf(row)),
              }}
              discard={() => staged.discardRow(row)}
              keepMine={
                staged.conflicts(row) ? () => staged.keepMine(row) : null
              }
              incompatible={null}
              saving={saving}
            />
          ))}
        </StagedChangesPopover>
      }
      notes={
        (error ?? invalid) ? (
          <HelperText status="error" size="sm">
            {error ?? invalid}
          </HelperText>
        ) : staged.hasConflicts ? (
          <HelperText status="warning" size="sm">
            Someone else saved changes to what you edited. Keep yours or use
            theirs.
          </HelperText>
        ) : null
      }
      target={
        draft ? null : (
          <Flex align="center" gap="2">
            <Text color="text-mid" whiteSpace="nowrap">
              Save to
            </Text>
            {/* With no drafts open, there's nothing to choose. */}
            {!drafts.length ? (
              <Text whiteSpace="nowrap">New draft</Text>
            ) : (
              <Box width="220px">
                <SelectField
                  size="md"
                  aria-label="Save to"
                  value={target}
                  onChange={setChosen}
                  options={[
                    ...drafts.map((d) => ({
                      label: revisionLabelText(
                        numbers.get(d.id) ?? 1,
                        d.title,
                        !!d.title,
                      ),
                      value: d.id,
                    })),
                    { label: "New draft", value: NEW_DRAFT },
                  ]}
                  sort={false}
                  disabled={saving}
                  containerStyle={{ marginBottom: 0 }}
                />
              </Box>
            )}
          </Flex>
        )
      }
      saving={saving}
      onDiscard={() => {
        staged.clear();
        setError(null);
        setTriedSave(false);
        setOpen(false);
      }}
      onSave={save}
    />
  );
}
