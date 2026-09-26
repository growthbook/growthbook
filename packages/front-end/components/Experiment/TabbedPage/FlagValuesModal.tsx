import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { expandSparseToFull, stripDefaultsForSparse } from "shared/util";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";
import { FIVE_LINES_HEIGHT } from "@/components/Forms/CodeTextArea";
import { formatJSON } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import VariationNumber from "@/ui/VariationNumber";
import { repairVariationValues, variationLabel } from "./variationValues";

export type FlagValuesResult = {
  values: Record<string, string>;
  sparse: boolean;
};

/** Edits one flag's per-variation values; the page's Save writes them. */
export default function FlagValuesModal({
  feature,
  variations,
  initialValues,
  initialSparse,
  sparseEligible,
  baseDefault,
  controlId,
  configBackingOptionKeys,
  focusVariationId,
  close,
  apply,
}: {
  feature: FeatureInterface;
  variations: { id: string; name: string; index: number }[];
  initialValues: Record<string, string>;
  initialSparse: boolean;
  sparseEligible: boolean;
  baseDefault: string;
  // Set when the control value is the default the others patch onto.
  controlId: string | null;
  configBackingOptionKeys?: string[];
  focusVariationId: string | null;
  close: () => void;
  apply: (result: FlagValuesResult) => void;
}) {
  // A value stored compact opens expanded in the editor.
  const [formatted] = useState(() =>
    Object.fromEntries(
      Object.entries(initialValues).map(([id, v]) => [id, formatJSON(v) ?? v]),
    ),
  );
  const [values, setValues] = useState(formatted);
  const [sparse, setSparse] = useState(initialSparse);

  // The editor mounts lazily, so retry until its input exists.
  useEffect(() => {
    if (!focusVariationId) return;
    let timer: ReturnType<typeof setTimeout>;
    let tries = 0;
    const tryFocus = () => {
      const row = document.getElementById(`flag-values-${focusVariationId}`);
      const field = row?.querySelector<HTMLElement>(
        "textarea, input:not([type='hidden']), [contenteditable='true']",
      );
      if (field && document.activeElement !== field) {
        row?.scrollIntoView({ block: "center" });
        field.focus();
      }
      if (document.activeElement !== field && ++tries < 20)
        timer = setTimeout(tryFocus, 100);
    };
    timer = setTimeout(tryFocus, 100);
    return () => clearTimeout(timer);
  }, [focusVariationId]);

  const base = (controlId ? values[controlId] : undefined) ?? baseDefault;
  const displayFeature = { ...feature, defaultValue: base };
  const configBacked = !!configBackingOptionKeys;

  // Rewrites every value, like the rule editors; control is the base itself.
  const toggleSparse = (checked: boolean) => {
    setValues((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, v]) =>
          id === controlId
            ? [id, v]
            : [
                id,
                checked
                  ? stripDefaultsForSparse(v, base)
                  : expandSparseToFull(v, base),
              ],
        ),
      ),
    );
    setSparse(checked);
  };

  // Repair loose values in place, then ask for a second apply, so nothing
  // lands that the user hasn't seen.
  const submit = () => {
    const { repaired } = repairVariationValues(
      feature,
      variations,
      (id) => values[id],
    );
    if (Object.keys(repaired).length) {
      setValues((prev) => ({ ...prev, ...repaired }));
      throw new Error(
        "We fixed some errors in the values. If they look correct, apply again.",
      );
    }
    // Untouched values go back as stored, so formatting alone isn't a change.
    apply({
      values: Object.fromEntries(
        Object.entries(values).map(([id, v]) => [
          id,
          v === formatted[id] ? initialValues[id] : v,
        ]),
      ),
      sparse,
    });
  };

  return (
    <ModalStandard
      trackingEventModalType="edit-flag-values"
      open={true}
      close={close}
      header={`Edit ${feature.id} values`}
      headerAction={
        sparseEligible ? (
          <SparsePatchToggle checked={sparse} onChange={toggleSparse} />
        ) : undefined
      }
      submit={submit}
      cta="Apply"
      size="lg"
    >
      <Flex direction="column" gap="4" pt="2">
        {variations.map((v) => (
          <Box key={v.id} id={`flag-values-${v.id}`}>
            <FeatureValueField
              // On the same row as the constant picker.
              label={
                <Flex as="span" align="center" gap="2">
                  <VariationNumber number={v.index} />
                  <Text weight="medium">{variationLabel(v)}</Text>
                </Flex>
              }
              id={`flag-values-${feature.id}-${v.id}`}
              value={values[v.id] ?? ""}
              setValue={(next) =>
                setValues((prev) => ({ ...prev, [v.id]: next }))
              }
              valueType={feature.valueType}
              feature={displayFeature}
              renderJSONInline
              useCodeInput
              showFullscreenButton
              codeInputDefaultHeight={FIVE_LINES_HEIGHT}
              sparse={sparse && v.id !== controlId}
              allowConfigBacking={configBacked}
              configBackingOptionKeys={configBackingOptionKeys}
              configBackingShowPatch={configBacked}
              lockConfigBacking={configBacked}
            />
          </Box>
        ))}
      </Flex>
    </ModalStandard>
  );
}
