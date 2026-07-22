import { useForm } from "react-hook-form";
import { useMemo } from "react";
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
} from "shared/util";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import { useConfigBacking } from "@/hooks/useConfigBacking";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import FeatureValueField from "@/components/Features/FeatureValueField";
import LoadingOverlay from "@/components/LoadingOverlay";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";

export interface Props {
  feature: FeatureInterface;
  cb: ApiContextualBanditInterface;
  linkedFeatureInfo: LinkedFeatureInfo;
  close: () => void;
  mutate: () => void;
}

type FeatureRevisionResponse = {
  revisions: FeatureRevisionInterface[];
};

type FormValues = { variations: { variationId: string; value: string }[] };

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
}: Props) {
  const { apiCall } = useAuth();
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);
  const { data, error } = useApi<FeatureRevisionResponse>(
    `/feature/${feature.id}`,
  );

  const targetVersion =
    linkedFeatureInfo.draftRevisionVersion ?? feature.version;

  const existingRule = useMemo<ContextualBanditRefRule | undefined>(() => {
    const matchesCbRule = (rule: { type: string }) =>
      rule.type === "contextual-bandit-ref" &&
      (rule as ContextualBanditRefRule).contextualBanditId === cb.id;
    const revision = (data?.revisions ?? []).find(
      (r) => r.version === targetVersion,
    );
    const ruleSources: unknown[] = [revision?.rules, feature.rules];
    for (const rules of ruleSources) {
      const match = naiveFlattenV1Rules(rules).find(matchesCbRule);
      if (match) return match as ContextualBanditRefRule;
    }
    return undefined;
  }, [data?.revisions, feature.rules, targetVersion, cb.id]);

  const initialVariations = useMemo(
    () =>
      cb.variations.map((v) => {
        const raw =
          linkedFeatureInfo.values.find((x) => x.variationId === v.id)?.value ??
          "";
        // Seed the config backing so a config-backed feature's bandit arms open
        // in the config-backing editor (matches the experiment-ref editor).
        return {
          variationId: v.id,
          value:
            isConfigBacked && defaultConfigKey
              ? ensureConfigBacking(raw, defaultConfigKey)
              : raw,
        };
      }),
    [cb.variations, linkedFeatureInfo.values, isConfigBacked, defaultConfigKey],
  );

  const form = useForm<FormValues>({
    defaultValues: { variations: initialVariations },
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-contextual-bandit-feature-values"
      header="Edit Feature Flag Values"
      subheader="Changes made here will be saved to a draft on the linked Feature Flag rule."
      cta="Save to draft"
      close={close}
      open={true}
      size={"lg"}
      submit={form.handleSubmit(async (values) => {
        if (!existingRule || !existingRule.id) {
          throw new Error(
            "Could not find the contextual-bandit rule on this feature.",
          );
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

        await apiCall<{ status: number; version: number }>(
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
          {cb.variations.map((v, i) => (
            <Box key={v.id}>
              <Flex align="center" direction="row" gap="2" mb="3">
                <Box className={`variation with-variation-label variation${i}`}>
                  <span className="label">{i}</span>
                </Box>
                <Text weight="semibold" size="large">
                  {v.name}
                </Text>
              </Flex>
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
              />
              {i < cb.variations.length - 1 && <Separator size="4" my="4" />}
            </Box>
          ))}
        </Flex>
      )}
    </ModalStandard>
  );
}
