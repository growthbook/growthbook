import { useState } from "react";
import { useForm } from "react-hook-form";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Modal from "@/components/Modal";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";

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

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  const metadataGated: boolean = (() => {
    const raw = settings?.requireReviews;
    if (raw === true) return true;
    if (!Array.isArray(raw)) return false;
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    return reviewSetting.featureRequireMetadataReview !== false;
  })();

  const canAutoPublish = isAdmin || !metadataGated;

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    canAutoPublish ? "publish" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const form = useForm<{ description: string }>({
    defaultValues: {
      description: feature.description || "",
    },
  });

  return (
    <Modal
      trackingEventModalType="edit-feature-description-modal"
      header="Edit Description"
      open={true}
      size="lg"
      close={close}
      submit={form.handleSubmit(async ({ description }) => {
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}`,
          {
            method: "PUT",
            body: JSON.stringify({
              description,
              ...(mode === "publish"
                ? { autoPublish: true }
                : mode === "existing"
                  ? { targetDraftVersion: selectedDraft }
                  : { forceNewDraft: true }),
            }),
          },
        );
        mutate();
        if (res?.draftVersion && setVersion) {
          setVersion(res.draftVersion);
        }
      })}
      cta={mode === "publish" ? "Save" : "Save to draft"}
      ctaEnabled={form.formState.isDirty}
      useRadixButton={true}
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
      />
      <Flex align="center" wrap="wrap" width="auto" mb="2">
        <Box as="div">
          <span className="pr-1">
            <Text as="span">Use markdown to format your content.</Text>
          </span>
          <Link
            rel="noreferrer"
            target="_blank"
            weight="bold"
            href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
          >
            Learn More
            <PiArrowSquareOutFill className="ml-1" />
          </Link>
        </Box>
      </Flex>
      <MarkdownInput
        value={form.watch("description")}
        setValue={(value) =>
          form.setValue("description", value, { shouldDirty: true })
        }
        placeholder="Add context about this feature for your team"
      />
    </Modal>
  );
}
