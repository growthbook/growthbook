import { useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { useDefaultDraftMode } from "@/hooks/useDefaultDraft";
import { useAuth } from "@/services/auth";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { ConflictProvider } from "@/components/DraftConflicts/ConflictContext";
import { useDraftConflict } from "@/components/DraftConflicts/useDraftConflict";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

interface Props {
  close: () => void;
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => void;
  setVersion?: (v: number) => void;
}

export default function EditFeatureDescriptionModal({
  close,
  feature,
  revisionList,
  mutate,
  setVersion,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    feature,
    "feature",
  );

  const metadataGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    return reviewSetting.featureRequireMetadataReview !== false;
  })();

  // Approval-gating decides whether publish needs review; AUTHORITY decides
  // whether this user may publish at all. Without the second factor a
  // draft-only user defaulted into publish mode and 403'd on submit. Metadata
  // carries no environment footprint, so the project-scoped atom is the rule.
  const canPublishMetadata = permissionsUtil.canPublishFeature(feature, []);
  const canAutoPublish = (isAdmin || !metadataGated) && canPublishMetadata;

  const { mode: initialMode, defaultDraft } = useDefaultDraftMode(
    revisionList,
    canAutoPublish,
  );

  const [mode, setMode] = useState<DraftMode>(initialMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );
  // An image still uploading would be dropped from the saved description.
  const [uploading, setUploading] = useState(false);

  const form = useForm<{ description: string }>({
    defaultValues: {
      description: feature.description || "",
    },
  });

  const conflict = useDraftConflict<{ description: string }>({
    initial: { description: feature.description || "" },
    labels: { description: "Description" },
    form,
    isNewDraft: mode === "new",
    entityNoun: "description",
  });

  return (
    <ConflictProvider {...conflict.providerProps}>
      <ModalStandard
        trackingEventModalType="edit-feature-description-modal"
        header="Edit Description"
        open={true}
        size="lg"
        close={close}
        submit={validatedSubmit(form, async (values) => {
          const description = values.description.trim();
          const guard = conflict.guard({ description });
          const res = await conflict.guarded(() =>
            apiCall<{ draftVersion?: number }>(
              `/feature/${feature.id}`,
              {
                method: "PUT",
                body: JSON.stringify({
                  description,
                  baseline: guard.baseline,
                  ...(mode === "publish"
                    ? { autoPublish: true }
                    : mode === "existing"
                      ? { targetDraftVersion: selectedDraft }
                      : { forceNewDraft: true }),
                }),
              },
              guard.onError,
            ),
          );
          conflict.clear();
          mutate();
          const resolvedVersion =
            res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
          if (resolvedVersion !== null && setVersion)
            setVersion(resolvedVersion);
        })}
        cta={mode === "publish" ? "Save" : "Save to draft"}
        ctaEnabled={
          // The editor doesn't report trailing whitespace, so the text is
          // compared without it.
          form.watch("description").trim() !==
            (feature.description || "").trim() &&
          conflict.resolved &&
          !uploading
        }
      >
        <DraftSelectorForChanges
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={canAutoPublish}
          gatedEnvSet={metadataGated ? "all" : "none"}
          alert={conflict.alert}
          alertActive={conflict.alertActive}
        />
        {conflict.callouts}
        <AIRichTextField
          value={form.watch("description")}
          onChange={(value) =>
            form.setValue("description", value, { shouldDirty: true })
          }
          placeholder="Add context about this feature for your team"
          collapsibleToolbar
          autoFocus
          onUploadingChange={setUploading}
        />
      </ModalStandard>
    </ConflictProvider>
  );
}
