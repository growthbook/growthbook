import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { ExperimentRefVariation } from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import { validateFeatureValue, getReviewSetting } from "shared/util";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import DraftSelectorDropdown, {
  DraftMode,
} from "@/components/Features/DraftSelectorDropdown";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import DialogLayout from "@/ui/Dialog/Patterns/DialogLayout";
import FeatureValueField from "@/components/Features/FeatureValueField";
import LoadingOverlay from "@/components/LoadingOverlay";
import Text from "@/ui/Text";
import { decimalToPercent } from "@/services/utils";
import MoreMenu from "@/components/Dropdown/MoreMenu";

export interface Props {
  feature: FeatureInterface;
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  close: () => void;
  mutate: () => void;
}

type FeatureRevisionResponse = {
  revisionList: MinimalFeatureRevisionInterface[];
};

type FormValues = {
  variationValues: { variationId: string; value: string }[];
};

export default function EditFeatureFlagValuesModal({
  feature,
  experiment,
  info,
  close,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const { data, error } = useApi<FeatureRevisionResponse>(
    `/feature/${feature.id}`,
  );
  const revisionList = data?.revisionList ?? [];

  const variations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  const initialValues = useMemo<
    { variationId: string; value: string }[]
  >(() => {
    return variations.map((v) => {
      const existing = info.values.find((x) => x.variationId === v.id);
      return {
        variationId: v.id,
        value: existing?.value ?? "",
      };
    });
  }, [variations, info.values]);

  const form = useForm<FormValues>({
    defaultValues: { variationValues: initialValues },
  });

  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);
  const canAutoPublish = isAdmin || gatedEnvSet === "none";

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    defaultDraft != null ? "existing" : canAutoPublish ? "publish" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  useEffect(() => {
    if (!canAutoPublish && mode === "publish") {
      setMode("new");
    }
  }, [canAutoPublish, mode]);

  const latestPhase = experiment.phases?.[experiment.phases.length - 1];
  const variationWeights = latestPhase?.variationWeights ?? [];

  const variationValues = form.watch("variationValues");

  return (
    <DialogLayout
      trackingEventModalType="edit-experiment-feature-values"
      header="Edit Feature Flag Values"
      subheader="Changes made here will be reflected on the linked Feature Flag rule."
      headerAction={
        <DraftSelectorDropdown
          feature={feature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={canAutoPublish}
          gatedEnvSet={gatedEnvSet}
        />
      }
      submit={form.handleSubmit(async (values) => {
        const updatedVariationValues: ExperimentRefVariation[] =
          values.variationValues.map((v) => {
            const fixed = validateFeatureValue(feature, v.value ?? "", "");
            return { variationId: v.variationId, value: fixed };
          });

        const needsRefix = updatedVariationValues.some(
          (v, i) => v.value !== values.variationValues[i].value,
        );
        if (needsRefix) {
          form.setValue("variationValues", updatedVariationValues);
          throw new Error(
            "We fixed some errors in the values. If they look correct, submit again.",
          );
        }

        const revisionOptions =
          mode === "publish"
            ? { autoPublish: true }
            : mode === "existing" && selectedDraft != null
              ? { targetVersion: selectedDraft }
              : { forceNewDraft: true };

        await apiCall<{ status: number }>(
          `/experiment/${experiment.id}/features`,
          {
            method: "POST",
            body: JSON.stringify({
              variations: experiment.variations,
              variationWeights,
              features: {
                [feature.id]: {
                  variations: updatedVariationValues,
                  revisionOptions,
                },
              },
            }),
          },
        );

        await mutate();
      })}
      cta={mode === "publish" ? "Publish now" : "Save to draft"}
      close={close}
      open={true}
      size={"lg"}
    >
      {error ? (
        <Text color="text-high">
          Failed to load feature revisions: {error.message}
        </Text>
      ) : !data ? (
        <Box style={{ position: "relative", minHeight: 80 }}>
          <LoadingOverlay />
        </Box>
      ) : (
        <Flex direction="column" gap="3" pt="2">
          {variations.map((v, i) => (
            <Box key={v.id}>
              <Flex justify="between" width="100%" mb="3">
                <Flex align="center" direction="row" gap="2">
                  <Flex align="center">
                    <Box
                      className={`variation with-variation-label variation${i}`}
                    >
                      <span className="label">{i}</span>
                    </Box>
                    <Text weight="semibold" size="large">
                      {v.name}
                    </Text>
                  </Flex>
                  <Box as="span">&middot;</Box>
                  <Text color="text-mid">
                    {decimalToPercent(latestPhase?.variationWeights?.[i] ?? 0)}%
                    Split
                  </Text>
                </Flex>
                <MoreMenu useRadix>
                  <a
                    href="#"
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      // setModalOpen(p);
                    }}
                  >
                    Edit
                  </a>
                </MoreMenu>
              </Flex>
              <FeatureValueField
                id={`variation-${v.id}`}
                value={variationValues?.[i]?.value ?? ""}
                setValue={(val) =>
                  form.setValue(`variationValues.${i}.value`, val)
                }
                valueType={feature.valueType}
                feature={feature}
                renderJSONInline={true}
                useCodeInput={true}
                showFullscreenButton={true}
              />
              {i < variations.length - 1 && <Separator size="4" my="4" />}
            </Box>
          ))}
        </Flex>
      )}
    </DialogLayout>
  );
}
