import { useForm } from "react-hook-form";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FeatureInterface,
  ContextualBanditRefRule,
} from "shared/types/feature";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ApiContextualBanditInterface } from "shared/validators";
import {
  naiveFlattenV1Rules,
  validateFeatureValue,
  ensureConfigBacking,
  DRAFT_REVISION_STATUSES,
} from "shared/util";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useConfigBacking } from "@/hooks/useConfigBacking";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureValueField from "@/components/Features/FeatureValueField";
import LoadingOverlay from "@/components/LoadingOverlay";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import { isUnsetFeatureValue } from "@/components/Features/EmptyStringConfirm";

export interface Props {
  feature: FeatureInterface;
  cb: ApiContextualBanditInterface;
  linkedFeatureInfo: LinkedFeatureInfo;
  close: () => void;
  mutate: () => void;
  /** Revision the values landed on — nothing on the page changes until it publishes. */
  onSaved?: (revisionVersion: number) => void;
}

type FeatureRevisionResponse = {
  revisions: FeatureRevisionInterface[];
};

type FormValues = {
  variations: {
    variationId: string;
    value: string;
    emptyStringConfirmed: boolean;
  }[];
};

/**
 * Edits the variation values on a feature's `contextual-bandit-ref` rule. Unlike
 * the experiment editor, CB variations/weights are owned by the bandit itself
 * (edited via the CB form), so this only touches the rule's per-variation values
 * and writes them through the generic feature rule-edit path.
 */
export default function EditContextualBanditFeatureValuesModal({
  feature,
  cb,
  linkedFeatureInfo,
  close,
  mutate,
  onSaved,
}: Props) {
  const { apiCall } = useAuth();
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);
  const { data, error } = useApi<FeatureRevisionResponse>(
    `/feature/${feature.id}`,
  );

  const cbRuleIn = useCallback(
    (rules: unknown): ContextualBanditRefRule | undefined =>
      naiveFlattenV1Rules(rules).find(
        (rule) =>
          rule.type === "contextual-bandit-ref" &&
          (rule as ContextualBanditRefRule).contextualBanditId === cb.id,
      ) as ContextualBanditRefRule | undefined,
    [cb.id],
  );

  // Target a draft already carrying staged changes to this rule, so repeated
  // edits accumulate there instead of spawning a new draft per save.
  const targetVersion = useMemo(() => {
    const openDraft = (data?.revisions ?? [])
      .filter(
        (r) =>
          r.version !== feature.version &&
          DRAFT_REVISION_STATUSES.includes(r.status) &&
          !!cbRuleIn(r.rules),
      )
      .sort((a, b) => b.version - a.version)[0];
    return (
      openDraft?.version ??
      linkedFeatureInfo.draftRevisionVersion ??
      linkedFeatureInfo.stagedDraft?.version ??
      feature.version
    );
  }, [
    data?.revisions,
    feature.version,
    cbRuleIn,
    linkedFeatureInfo.draftRevisionVersion,
    linkedFeatureInfo.stagedDraft,
  ]);

  const existingRule = useMemo<ContextualBanditRefRule | undefined>(() => {
    const revision = (data?.revisions ?? []).find(
      (r) => r.version === targetVersion,
    );
    return cbRuleIn(revision?.rules) ?? cbRuleIn(feature.rules);
  }, [data?.revisions, feature.rules, targetVersion, cbRuleIn]);

  const initialVariations = useMemo(
    () =>
      cb.variations.map((v) => {
        // Staged values win — they are what the targeted revision holds.
        const stagedEntry = (
          linkedFeatureInfo.stagedDrafts ??
          (linkedFeatureInfo.stagedDraft ? [linkedFeatureInfo.stagedDraft] : [])
        )
          .map((d) => d.values.find((x) => x.variationId === v.id))
          .find((x) => x !== undefined);
        const entry =
          existingRule?.variations?.find((x) => x.variationId === v.id) ??
          stagedEntry ??
          linkedFeatureInfo.values.find((x) => x.variationId === v.id);
        const raw = entry?.value ?? "";
        // Seed the config backing so a config-backed feature's bandit arms open
        // in the config-backing editor (matches the experiment-ref editor).
        const value =
          isConfigBacked && defaultConfigKey
            ? ensureConfigBacking(raw, defaultConfigKey)
            : raw;
        return {
          variationId: v.id,
          value,
          emptyStringConfirmed: !!entry && value === "",
        };
      }),
    [
      cb.variations,
      existingRule,
      linkedFeatureInfo.values,
      linkedFeatureInfo.stagedDraft,
      linkedFeatureInfo.stagedDrafts,
      isConfigBacked,
      defaultConfigKey,
    ],
  );

  const form = useForm<FormValues>({
    defaultValues: { variations: initialVariations },
  });

  const seededFromRevision = useRef(false);
  useEffect(() => {
    if (seededFromRevision.current || !data || !existingRule) return;
    seededFromRevision.current = true;
    form.reset({ variations: initialVariations });
  }, [data, existingRule, initialVariations, form]);

  const [showValueErrors, setShowValueErrors] = useState(false);

  const isUnsetAt = (i: number) =>
    isUnsetFeatureValue({
      valueType: feature.valueType,
      value: form.watch(`variations.${i}.value`) ?? "",
      emptyStringConfirmed: !!form.watch(
        `variations.${i}.emptyStringConfirmed`,
      ),
    });

  return (
    <ModalStandard
      trackingEventModalType="edit-contextual-bandit-feature-values"
      header="Edit Feature Flag Values"
      subheader="Changes made here will be saved to a draft on the linked Feature Flag rule."
      cta="Save to draft"
      // Nothing to submit until the revisions load and there's a rule to patch.
      ctaEnabled={!!data && !!existingRule}
      close={close}
      open={true}
      size={"lg"}
      submit={form.handleSubmit(async (values) => {
        if (!existingRule || !existingRule.id) {
          throw new Error(
            "Could not find the contextual-bandit rule on this feature.",
          );
        }

        const hasUnsetValue = values.variations.some((r) =>
          isUnsetFeatureValue({
            valueType: feature.valueType,
            value: r.value ?? "",
            emptyStringConfirmed: !!r.emptyStringConfirmed,
          }),
        );
        if (hasUnsetValue) {
          setShowValueErrors(true);
          throw new Error("Set a value for every variation before saving");
        }

        const updatedVariations = values.variations.map((r) => ({
          variationId: r.variationId,
          value: validateFeatureValue(feature, r.value ?? "", ""),
        }));

        const needsRefix = updatedVariations.some(
          (v, i) => v.value !== (values.variations[i].value ?? ""),
        );
        if (needsRefix) {
          updatedVariations.forEach((v, i) => {
            form.setValue(`variations.${i}.value`, v.value);
          });
          throw new Error(
            "We fixed some errors in the values. If they look correct, submit again.",
          );
        }

        const updatedRule: ContextualBanditRefRule = {
          ...existingRule,
          variations: updatedVariations,
        };

        const res = await apiCall<{ status: number; version: number }>(
          `/feature/${feature.id}/${targetVersion}/rule`,
          {
            method: "PUT",
            body: JSON.stringify({
              rule: updatedRule,
              ruleId: existingRule.id,
            }),
          },
        );

        await mutate();
        // The save lands on a draft the card can't show — report where it went.
        if (res?.version != null) onSaved?.(res.version);
      })}
    >
      {error ? (
        <Text color="text-high">
          Failed to load feature revisions: {error.message}
        </Text>
      ) : !data ? (
        <Box style={{ position: "relative", minHeight: 80 }}>
          <LoadingOverlay />
        </Box>
      ) : !existingRule ? (
        <Callout status="warning">
          Could not find a contextual-bandit rule for this bandit on the
          selected feature revision.
        </Callout>
      ) : (
        <Flex direction="column" gap="3" pt="2">
          {cb.status === "running" && (
            <Callout status="warning" size="sm">
              This Bandit is running. Users in each variation keep seeing the
              current value until you publish the Feature Flag revision this
              draft creates.
            </Callout>
          )}
          {cb.variations.map((v, i) => (
            <Box key={v.id}>
              <Box mb="3" minWidth="0">
                <VariationLabel number={i} name={v.name} size="lg" />
              </Box>
              {showValueErrors && isUnsetAt(i) && (
                <HelperText status="error">
                  {feature.valueType === "string"
                    ? "Set a value, or confirm you want an empty string"
                    : "Set a value for this variation"}
                </HelperText>
              )}
              <FeatureValueField
                id={`variation-${v.id}`}
                value={form.watch(`variations.${i}.value`) ?? ""}
                setValue={(val) => form.setValue(`variations.${i}.value`, val)}
                valueType={feature.valueType}
                feature={feature}
                renderJSONInline={true}
                useCodeInput={true}
                showFullscreenButton={true}
                sparse={isConfigBacked}
                allowConfigBacking={isConfigBacked}
                configBackingOptionKeys={configBackingOptionKeys}
                configBackingShowPatch={isConfigBacked}
                lockConfigBacking={isConfigBacked}
                confirmEmptyString
                emptyStringConfirmed={
                  !!form.watch(`variations.${i}.emptyStringConfirmed`)
                }
                setEmptyStringConfirmed={(checked) =>
                  form.setValue(`variations.${i}.emptyStringConfirmed`, checked)
                }
              />
              {i < cb.variations.length - 1 && <Separator size="4" my="4" />}
            </Box>
          ))}
        </Flex>
      )}
    </ModalStandard>
  );
}
