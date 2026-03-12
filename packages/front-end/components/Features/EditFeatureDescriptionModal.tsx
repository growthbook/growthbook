import { useMemo, useState } from "react";
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
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";
import Badge from "@/ui/Badge";
import RevisionDropdown from "@/components/Features/RevisionDropdown";

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

  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  const [autoPublish, setAutoPublish] = useState(canAutoPublish);

  const defaultDraft = useMemo((): number | null => {
    if (activeDrafts.length > 0) return activeDrafts[0].version;
    return null;
  }, [activeDrafts]);

  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );
  const displayedDraft = autoPublish ? null : selectedDraft;

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
              ...(autoPublish
                ? { autoPublish: true }
                : selectedDraft != null
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
      cta={autoPublish ? "Save" : "Save to draft"}
      useRadixButton={true}
    >
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

      <Box mt="4" mb="3">
        <RevisionDropdown
          feature={feature}
          revisions={revisionList}
          version={displayedDraft}
          setVersion={() => undefined}
          onVersionChange={setSelectedDraft}
          draftsOnly
          variant="select"
          disabled={autoPublish}
        />
        {!autoPublish && (
          <Flex align="center" gap="2" mt="2" wrap="wrap">
            <Text size="small" color="text-low">
              Environments affected in this draft:
            </Text>
            <Badge
              label="all environments"
              color="gray"
              variant="soft"
              radius="small"
              style={{ fontSize: "11px" }}
            />
          </Flex>
        )}
      </Box>

      {canAutoPublish && (
        <Checkbox
          id="edit-description-auto-publish"
          label="Automatically publish as a new revision"
          description={
            metadataGated
              ? "Bypass approval and publish now"
              : "No approval required for metadata changes"
          }
          value={autoPublish}
          setValue={setAutoPublish}
        />
      )}
    </Modal>
  );
}
