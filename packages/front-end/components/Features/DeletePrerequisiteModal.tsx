import { useMemo, useState } from "react";
import { Box } from "@radix-ui/themes";
import { FeatureInterface, FeaturePrerequisite } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { isActiveDraftStatus } from "shared/validators";
import { useAuth } from "@/services/auth";
import track, { entityTrackingHash } from "@/services/track";
import Modal from "@/components/Modal";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";

// Removes a top-level prerequisite, into a draft the user picks.
export default function DeletePrerequisiteModal({
  i,
  feature,
  baseline,
  revisionList,
  gatedEnvSet,
  mutate,
  setVersion,
  close,
}: {
  i: number;
  feature: FeatureInterface;
  // The list as it was when the user chose to remove `i`.
  baseline: FeaturePrerequisite[];
  revisionList: MinimalFeatureRevisionInterface[];
  gatedEnvSet: Set<string> | "all" | "none";
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const latestActiveDraft = useMemo(
    () =>
      revisionList
        .filter((r) => isActiveDraftStatus(r.status))
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [revisionList],
  );
  const [mode, setMode] = useState<DraftMode>(
    latestActiveDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    latestActiveDraft?.version ?? null,
  );

  return (
    <Modal
      trackingEventModalType="delete-prerequisite"
      header="Delete Prerequisite"
      size="lg"
      open={true}
      close={close}
      cta="Delete"
      submit={async () => {
        close();
        track("Delete Prerequisite", {
          entity_id_hash: entityTrackingHash(feature.id),
          prerequisiteIndex: i,
        });
        const draftBody =
          mode === "existing"
            ? { targetDraftVersion: selectedDraft }
            : { forceNewDraft: true };
        const res = await apiCall<{ draftVersion: number }>(
          `/feature/${feature.id}/prerequisite`,
          {
            method: "DELETE",
            // Index-addressed, so the list it was read from has to match.
            body: JSON.stringify({ i, baseline, ...draftBody }),
          },
        );
        await mutate();
        const resolvedVersion =
          res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
        if (resolvedVersion !== null) setVersion(resolvedVersion);
      }}
    >
      <Box style={{ minHeight: 300 }}>
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={false}
          gatedEnvSet={gatedEnvSet}
        />
        <p>Are you sure you want to delete this prerequisite?</p>
      </Box>
    </Modal>
  );
}
