import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentRefVariation, FeatureValueType } from "shared/validators";
import { getLatestPhaseVariations } from "shared/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ValueTypeField from "@/components/Features/FeatureModal/ValueTypeField";
import FeatureValueField from "@/components/Features/FeatureValueField";
import VariationLabel from "@/ui/VariationLabel";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import Text from "@/ui/Text";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";

/** Upper bound on waiting for the dynamically imported value editor. */
const FOCUS_WAIT_MS = 2000;
/** Timers, not rAF: rAF is suspended while the tab is in the background. */
const FOCUS_POLL_MS = 50;

/** Boolean is a poor fit for most experiments, so it sits last. */
const VALUE_TYPE_ORDER: FeatureValueType[] = [
  "string",
  "json",
  "number",
  "boolean",
];

type KeyPlan = {
  derivedId: string;
  derivedIdAvailable: boolean;
  sanitized: boolean;
  suggestedPair: { trackingKey: string; featureId: string } | null;
  regexError: string | null;
};

type FormValues = {
  valueType: FeatureValueType;
  variations: { id: string; value: string }[];
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  close: () => void;
  mutate: () => void;
  /** Preselect this variation's value field, when opened from a variation card. */
  focusVariationId?: string | null;
}

export default function AddManagedFlagModal({
  experiment,
  close,
  mutate,
  focusVariationId,
}: Props) {
  const { apiCall } = useAuth();
  /** Set when the user accepts the suggested matching key/id pair. */
  const [renameTo, setRenameTo] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);

  const { data } = useApi<{ blocker: string | null; keyPlan: KeyPlan }>(
    `/experiment/${experiment.id}/managed-flag/key-plan`,
  );

  const variations = useMemo(
    () => getLatestPhaseVariations(experiment),
    [experiment],
  );

  const form = useForm<FormValues>({
    defaultValues: {
      valueType: "string",
      variations: variations.map((v, i) => ({
        id: v.id,
        value: v.key || String(i),
      })),
    },
  });
  const valueType = form.watch("valueType");

  // Mirrors FeatureFromExperimentModal so a type switch leaves usable values
  // rather than something the field will reject.
  function updateValuesOnTypeChange(next: FeatureValueType) {
    if (next === valueType) return;
    form.setValue("valueType", next);
    const transform = (v: string, i: number) => {
      if (next === "boolean") {
        // Position is the fallback, control off: a truthiness test would make
        // every seeded value true and serve one value to everyone.
        const t = v.trim().toLowerCase();
        if (["", "0", "false"].includes(t)) return "false";
        if (["1", "true"].includes(t)) return "true";
        return i === 0 ? "false" : "true";
      }
      if (next === "number") return String(Number(v) || 0);
      if (next === "json") {
        return valueType === "string"
          ? `{\n  "value": ${JSON.stringify(v)}\n}`
          : `{\n  "value": ${v}\n}`;
      }
      return v;
    };
    form.setValue(
      "variations",
      form
        .getValues("variations")
        .map((v, i) => ({ ...v, value: transform(v.value, i) })),
    );
  }

  const keyPlan = data?.keyPlan;
  const blocker = data?.blocker ?? null;

  // The body renders only once the key plan loads, and JSON values render in a
  // dynamically imported editor after that, so wait for the field to appear.
  useEffect(() => {
    if (!focusVariationId || !data || blocker) return;
    let timer: ReturnType<typeof setTimeout>;
    const giveUpAt = Date.now() + FOCUS_WAIT_MS;
    const tryFocus = () => {
      const row = document.getElementById(`managed-value-${focusVariationId}`);
      const field = row?.querySelector<HTMLElement>(
        "textarea, input:not([type='hidden']), [contenteditable='true']",
      );
      if (field) {
        if (document.activeElement === field) return;
        // Radix re-targets focus while the dialog mounts, so one call gets
        // dropped. Re-apply until a control inside the dialog holds focus —
        // anything else means the user has not chosen yet.
        const active = document.activeElement as HTMLElement | null;
        const dialog = row?.closest("[role='dialog']");
        const userMovedFocus =
          !!active &&
          !!dialog?.contains(active) &&
          active.matches(
            "input, textarea, select, button, a[href], [contenteditable='true']",
          );
        if (!userMovedFocus) {
          row?.scrollIntoView({ block: "center" });
          field.focus();
        }
      }
      if (Date.now() < giveUpAt) timer = setTimeout(tryFocus, FOCUS_POLL_MS);
    };
    tryFocus();
    return () => clearTimeout(timer);
  }, [focusVariationId, data, blocker]);

  const keyUnresolved =
    !!keyPlan && !keyPlan.derivedIdAvailable && !renameTo && !manualKey;

  return (
    <ModalStandard
      trackingEventModalType="add-managed-flag"
      trackingEventModalSource="experiment-implementation"
      open={true}
      // This modal places focus itself; Radix would take the close button.
      onOpenAutoFocus={(e) => {
        if (focusVariationId) e.preventDefault();
      }}
      size="lg"
      close={close}
      header="Automatic Implementation"
      subheader="Set the value each variation serves. This Experiment creates and manages a Feature Flag for you, and review and publishing stay on this page."
      cta="Create implementation"
      ctaEnabled={
        !!keyPlan && !blocker && !keyUnresolved && !keyPlan.regexError
      }
      submit={form.handleSubmit(async (values) => {
        const refVariations: ExperimentRefVariation[] = values.variations.map(
          (v) => ({ variationId: v.id, value: v.value }),
        );
        // A throw here is surfaced by the modal's own error banner.
        await apiCall(`/experiment/${experiment.id}/managed-flag`, {
          method: "POST",
          body: JSON.stringify({
            valueType: values.valueType,
            variations: refVariations,
            ...(manualKey ? { featureId: manualKey } : {}),
            ...(renameTo && !manualKey ? { trackingKey: renameTo } : {}),
          }),
        });
        mutate();
      })}
    >
      {blocker && (
        <Callout status="warning" mb="3">
          {blocker}
        </Callout>
      )}

      {keyPlan && !blocker && (
        <Box mb="4">
          {keyPlan.derivedIdAvailable ? (
            <Metadata
              label="Feature Flag key"
              value={<Text weight="semibold">{keyPlan.derivedId}</Text>}
            />
          ) : (
            <Callout status="warning">
              <Box>
                A Feature Flag named <strong>{keyPlan.derivedId}</strong>{" "}
                already exists, so it can&apos;t match this Experiment&apos;s
                key.
              </Box>
              <Flex align="center" gap="3" mt="2" wrap="wrap">
                {keyPlan.suggestedPair && (
                  <Button
                    variant={renameTo ? "solid" : "outline"}
                    size="sm"
                    onClick={() => {
                      setManualKey(null);
                      setRenameTo(keyPlan.suggestedPair?.trackingKey ?? null);
                    }}
                  >
                    Use {keyPlan.suggestedPair.trackingKey} for both
                  </Button>
                )}
                {manualKey === null && (
                  <Link
                    onClick={() => {
                      setRenameTo(null);
                      setManualKey("");
                    }}
                  >
                    <Text size="sm" weight="semibold">
                      Choose a Feature Flag key instead
                    </Text>
                  </Link>
                )}
              </Flex>
              {renameTo && (
                <Box mt="2">
                  <Text size="sm" color="text-low">
                    The Experiment Key becomes <strong>{renameTo}</strong> and
                    the Feature Flag is created with the same key.
                  </Text>
                </Box>
              )}
            </Callout>
          )}

          {manualKey !== null && (
            <Box mt="3">
              <Field
                label="Feature Flag key"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                pattern="^[a-zA-Z0-9_.:|\-]+$"
                title="Only letters, numbers, and the characters '_-.:|' allowed. No spaces."
                required
                helpText="Won't match the Experiment Key. Cannot be changed later."
              />
            </Box>
          )}

          {keyPlan.regexError && (
            <Callout status="error" mt="3">
              {keyPlan.regexError}
            </Callout>
          )}

          {keyPlan.derivedIdAvailable && keyPlan.sanitized && (
            <Box mt="1">
              <Text size="sm" color="text-low">
                Adapted from the Experiment Key, which contains characters a
                Feature Flag key can&apos;t use.
              </Text>
            </Box>
          )}
        </Box>
      )}

      {!blocker && (
        <>
          <ValueTypeField
            value={valueType}
            order={VALUE_TYPE_ORDER}
            onChange={(val) => {
              if (val !== "config") updateValuesOnTypeChange(val);
            }}
          />

          <Flex direction="column" gap="3" pt="2">
            <Text as="label" weight="semibold" mb="0">
              Variation Values
            </Text>
            {variations.map((v, i) => (
              <Box key={v.id}>
                <Box mb="3">
                  <VariationLabel number={i} name={v.name} />
                </Box>
                <Box id={`managed-value-${v.id}`}>
                  <FeatureValueField
                    id={`managed-field-${v.id}`}
                    value={form.watch(`variations.${i}.value`) || ""}
                    setValue={(val) =>
                      form.setValue(`variations.${i}.value`, val)
                    }
                    valueType={valueType}
                    useCodeInput={true}
                    showFullscreenButton={true}
                  />
                </Box>
                {i < variations.length - 1 && <Separator size="4" my="4" />}
              </Box>
            ))}
          </Flex>

          <Text size="sm" color="text-low">
            Values go live when you start the Experiment.
          </Text>
        </>
      )}
    </ModalStandard>
  );
}
