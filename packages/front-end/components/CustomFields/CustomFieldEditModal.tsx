import { FC, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CustomFieldSection } from "shared/types/custom-fields";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  filterCustomFieldsForSectionAndProject,
  reconcileCustomFieldValues,
} from "@/services/customFields";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import CustomFieldInput from "./CustomFieldInput";

/** Optional draft-mode context for feature metadata approval flows. */
export interface CustomFieldDraftInfo {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  gatedEnvSet: Set<string> | "all" | "none";
  /** Called with the new/updated draft version after save so the UI can switch to it. */
  onDraftCreated: (version: number) => void;
}

const CustomFieldEditModal: FC<{
  section: CustomFieldSection;
  target: ExperimentInterfaceStringDates | FeatureInterface;
  close: () => void;
  mutate?: () => void;
  /** When provided, the modal shows a draft callout and "Save to Draft" CTA. */
  draftInfo?: CustomFieldDraftInfo;
}> = ({ section, target, close, mutate, draftInfo }) => {
  const { apiCall } = useAuth();

  const canAutoPublish = !draftInfo || draftInfo.gatedEnvSet === "none";

  const latestActiveDraft = useMemo(
    () =>
      (draftInfo?.revisionList ?? [])
        .filter((r) =>
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [draftInfo],
  );

  const [mode, setMode] = useState<DraftMode>(
    canAutoPublish
      ? "publish"
      : latestActiveDraft !== null
        ? "existing"
        : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    latestActiveDraft?.version ?? null,
  );

  const customFields =
    filterCustomFieldsForSectionAndProject(
      useCustomFields(),
      section,
      target.project,
    ) ?? [];

  const form = useForm<{ customFields: Record<string, string> }>({
    defaultValues: {
      customFields: reconcileCustomFieldValues(
        customFields,
        target.customFields,
      ),
    },
  });

  const customFieldValues = form.watch("customFields");

  const submitForm = async (value) => {
    if (section === "experiment") {
      await apiCall(`/experiment/${target.id}`, {
        method: "POST",
        body: JSON.stringify({ ...value }),
      });
    } else if (section === "feature") {
      const body: Record<string, unknown> = { ...value };
      if (draftInfo) {
        if (mode === "publish") {
          body.autoPublish = true;
        } else if (mode === "existing") {
          body.targetDraftVersion = selectedDraft;
        } else {
          body.forceNewDraft = true;
        }
      }
      const res = await apiCall<{ draftVersion?: number }>(
        `/feature/${target.id}`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );
      if (res?.draftVersion !== undefined && draftInfo) {
        draftInfo.onDraftCreated(res.draftVersion);
      }
    }
    if (mutate) mutate();
  };

  return (
    <ModalStandard
      trackingEventModalType="edit-custom-fields"
      header={"Edit Custom Fields"}
      open={true}
      close={close}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        await submitForm(value);
      })}
      cta={
        draftInfo ? (mode === "publish" ? "Publish" : "Save to Draft") : "Save"
      }
      ctaEnabled={form.formState.isDirty}
    >
      {draftInfo && (
        <DraftSelectorForChanges
          feature={draftInfo.feature}
          revisionList={draftInfo.revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={canAutoPublish}
          gatedEnvSet={draftInfo.gatedEnvSet}
        />
      )}
      <CustomFieldInput
        fields={customFields}
        value={customFieldValues}
        onChange={(value) => {
          form.setValue("customFields", value, { shouldDirty: true });
        }}
      />
    </ModalStandard>
  );
};

export default CustomFieldEditModal;
