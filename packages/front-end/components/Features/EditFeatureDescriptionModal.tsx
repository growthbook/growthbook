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
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftRevisionCallout from "@/components/Features/DraftRevisionCallout";

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

  const metadataReviewRequired = useMemo(() => {
    const requireReviewSettings = settings?.requireReviews;
    if (!requireReviewSettings || typeof requireReviewSettings === "boolean") {
      return false;
    }
    const reviewSetting = getReviewSetting(requireReviewSettings, feature);
    return !!reviewSetting?.requireReviewOn;
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
        const res = await apiCall<{ draftVersion?: number }>(
          `/feature/${feature.id}`,
          {
            method: "PUT",
            body: JSON.stringify({ description }),
          },
        );
        mutate();
        if (res?.draftVersion && setVersion) {
          setVersion(res.draftVersion);
        }
      })}
      cta={metadataReviewRequired ? "Save to Draft" : "Save"}
      useRadixButton={true}
    >
      {metadataReviewRequired && (
        <DraftRevisionCallout activeDraft={activeDraft} />
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
