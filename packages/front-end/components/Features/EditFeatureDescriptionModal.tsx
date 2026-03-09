import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { getReviewSetting } from "shared/util";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Modal from "@/components/Modal";
import Callout from "@/ui/Callout";
import useOrgSettings from "@/hooks/useOrgSettings";

interface Props {
  close: () => void;
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  mutate: () => void;
}

export default function EditFeatureDescriptionModal({
  close,
  feature,
  revisionList,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();

  const metadataReviewRequired = useMemo(() => {
    const requireReviewSettings = settings?.requireReviews;
    if (!requireReviewSettings || typeof requireReviewSettings === "boolean") {
      return false;
    }
    const reviewSetting = getReviewSetting(requireReviewSettings, feature);
    return !!(
      reviewSetting?.requireReviewOn &&
      reviewSetting?.featureRequireMetadataReview
    );
  }, [settings?.requireReviews, feature]);

  const activeDraft = useMemo(
    () =>
      revisionList
        .filter((r) =>
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
        )
        .sort((a, b) => b.version - a.version)[0] ?? null,
    [revisionList],
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
        await apiCall(`/feature/${feature.id}`, {
          method: "PUT",
          body: JSON.stringify({ description }),
        });
        mutate();
      })}
      cta={metadataReviewRequired ? "Save to Draft" : "Save"}
      useRadixButton={true}
    >
      {metadataReviewRequired && (
        <Box mb="4">
          {activeDraft ? (
            <Callout status="info">
              Changes will be added to{" "}
              <strong>Revision {activeDraft.version}</strong> (
              {activeDraft.status}).
            </Callout>
          ) : (
            <Callout status="info">
              A new draft revision will be created for these changes.
            </Callout>
          )}
        </Box>
      )}
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
        setValue={(value) => form.setValue("description", value)}
        placeholder="Add context about this feature for your team"
      />
    </Modal>
  );
}
