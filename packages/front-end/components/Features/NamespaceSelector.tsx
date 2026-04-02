import { useEffect, useMemo, useState } from "react";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { FaPlus, FaTrash } from "react-icons/fa";
import { Namespaces } from "shared/types/organization";
import useApi from "@/hooks/useApi";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import NamespaceUsageGraph from "./NamespaceUsageGraph";
import {
  normalizeRangeAfterLowerChange,
  normalizeRangeAfterUpperChange,
  getLargestGap,
  RangeTuple,
  shiftDraftKeysAfterRangeRemoval,
  subtractSelectedRangesFromGaps,
  trimDraftKeysToRangeLength,
} from "./NamespaceSelectorUtils";

const EMPTY_RANGES: RangeTuple[] = [];
const EMPTY_NAMESPACES: Namespaces[] = [];
const EMPTY_NAMESPACE_USAGE = {};

export interface Props {
  featureId: string;
  trackingKey?: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  formPrefix?: string;
  experimentHashAttribute?: string;
  fallbackAttribute?: string;
}

type NamespaceFormState = {
  enabled?: boolean;
  name?: string;
  range?: RangeTuple;
  ranges?: RangeTuple[];
  format?: string;
  hashAttribute?: string;
};

export default function NamespaceSelector({
  form,
  featureId,
  formPrefix = "",
  trackingKey = "",
  experimentHashAttribute,
  fallbackAttribute,
}: Props) {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`,
  );
  const { namespaces } = useOrgSettings();
  const [rangeDrafts, setRangeDrafts] = useState<Record<string, string>>({});
  const namespacePath = `${formPrefix}namespace`;
  const namespaceNamePath = `${namespacePath}.name`;
  const namespaceRangesPath = `${namespacePath}.ranges`;
  const namespaceFormatPath = `${namespacePath}.format`;
  const namespaceHashAttributePath = `${namespacePath}.hashAttribute`;
  const namespaceEnabledPath = `${namespacePath}.enabled`;

  const namespaceState =
    (useWatch({
      control: form.control,
      name: namespacePath,
    }) as NamespaceFormState | undefined) || {};
  const watchedHashAttribute =
    (useWatch({
      control: form.control,
      name: "hashAttribute",
    }) as string | undefined) || "";
  const watchedFallbackAttribute =
    (useWatch({
      control: form.control,
      name: "fallbackAttribute",
    }) as string | undefined) || "";

  const namespace = namespaceState.name || "";
  const enabled = !!namespaceState.enabled;
  const storedRanges = namespaceState.ranges || EMPTY_RANGES;
  const legacyRange =
    Array.isArray(namespaceState.range) && namespaceState.range.length === 2
      ? (namespaceState.range as RangeTuple)
      : undefined;
  const ranges = useMemo(
    () =>
      storedRanges.length > 0
        ? storedRanges
        : legacyRange
          ? [legacyRange]
          : EMPTY_RANGES,
    [legacyRange, storedRanges],
  );

  const effectiveHashAttribute =
    experimentHashAttribute || watchedHashAttribute || "";
  const effectiveFallbackAttribute =
    fallbackAttribute ?? watchedFallbackAttribute ?? "";
  const isFallbackMode = !!effectiveFallbackAttribute.trim();
  const allNamespaces = namespaces || EMPTY_NAMESPACES;
  const namespaceUsage = data?.namespaces || EMPTY_NAMESPACE_USAGE;
  const isLegacyNamespace = (n: Namespaces) => n.format !== "multiRange";

  const {
    filteredNamespaces,
    namespaceOptions,
    selectedNamespace,
    selectedIsDifferentHash,
  } = useMemo(() => {
    const activeNamespaces = allNamespaces.filter(
      (n) => n?.status !== "inactive",
    );
    const filtered = isFallbackMode
      ? activeNamespaces.filter((n) => isLegacyNamespace(n))
      : activeNamespaces;
    const matchingNamespaces = activeNamespaces.filter((n) => {
      if (isLegacyNamespace(n)) return true;
      return n.hashAttribute === effectiveHashAttribute;
    });
    const differentHashNamespaces = activeNamespaces.filter((n) => {
      if (isLegacyNamespace(n)) return false;
      return n.hashAttribute !== effectiveHashAttribute;
    });

    return {
      filteredNamespaces: filtered,
      namespaceOptions: (isFallbackMode
        ? filtered.map((n) => ({ value: n.name, label: n.label }))
        : [
            ...matchingNamespaces.map((n) => ({
              value: n.name,
              label: n.label,
            })),
            ...differentHashNamespaces.map((n) => ({
              value: n.name,
              label: n.label,
            })),
          ]) as SingleValue[],
      selectedNamespace: activeNamespaces.find((n) => n.name === namespace),
      selectedIsDifferentHash:
        !isFallbackMode &&
        activeNamespaces.some(
          (n) =>
            n.name === namespace &&
            n.format === "multiRange" &&
            n.hashAttribute !== effectiveHashAttribute,
        ),
    };
  }, [allNamespaces, effectiveHashAttribute, isFallbackMode, namespace]);

  const persistedGaps = useMemo(
    () => findGaps(namespaceUsage, namespace, featureId, trackingKey),
    [namespaceUsage, namespace, featureId, trackingKey],
  );
  const largestAvailableGap = useMemo(
    () => getLargestGap(subtractSelectedRangesFromGaps(persistedGaps, ranges)),
    [persistedGaps, ranges],
  );
  const totalAllocation = useMemo(
    () => ranges.reduce((sum, [start, end]) => sum + (end - start), 0),
    [ranges],
  );

  const getDraftKey = (index: number, field: 0 | 1) => `${index}:${field}`;

  useEffect(() => {
    if (!namespace) return;
    const existsInFiltered = filteredNamespaces.some(
      (n) => n.name === namespace,
    );
    if (existsInFiltered) return;
    form.setValue(namespaceNamePath, "");
    form.setValue(namespaceRangesPath, []);
    setRangeDrafts({});
  }, [
    filteredNamespaces,
    form,
    namespace,
    namespaceNamePath,
    namespaceRangesPath,
  ]);

  useEffect(() => {
    if (storedRanges.length > 0 || !legacyRange) return;
    form.setValue(namespaceRangesPath, [legacyRange]);
  }, [form, legacyRange, namespaceRangesPath, storedRanges.length]);

  useEffect(() => {
    setRangeDrafts((current) => {
      const next = trimDraftKeysToRangeLength(current, ranges.length);
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (
        currentKeys.length === nextKeys.length &&
        currentKeys.every((key) => next[key] === current[key])
      ) {
        return current;
      }

      return next;
    });
  }, [ranges.length]);

  const getAvailableGapsForRange = (index: number) => {
    return subtractSelectedRangesFromGaps(
      persistedGaps,
      ranges.filter((_, rangeIndex) => rangeIndex !== index),
    );
  };

  const setRangeAtIndex = (index: number, nextRange: RangeTuple) => {
    const newRanges = ranges.map((r, i) =>
      i === index ? ([...r] as RangeTuple) : r,
    );
    newRanges[index] = nextRange;
    form.setValue(namespaceRangesPath, newRanges);
  };

  const commitDraftValue = (index: number, field: 0 | 1, rawValue: string) => {
    const parsed = Number.parseFloat(rawValue);
    const currentRange = ranges[index] || [0, 1];
    const availableGaps = getAvailableGapsForRange(index);
    const nextRange =
      field === 0
        ? normalizeRangeAfterLowerChange(currentRange, parsed, availableGaps)
        : normalizeRangeAfterUpperChange(currentRange, parsed, availableGaps);

    setRangeAtIndex(index, nextRange);
    setRangeDrafts((current) => {
      const next = { ...current };
      delete next[getDraftKey(index, field)];
      return next;
    });
  };

  if (!data || error || !allNamespaces.length) return null;

  const addRange = () => {
    if (largestAvailableGap) {
      const newRanges = [
        ...ranges,
        [largestAvailableGap.start, largestAvailableGap.end] as RangeTuple,
      ];
      form.setValue(namespaceRangesPath, newRanges);
    }
  };

  const removeRange = (index: number) => {
    const newRanges = ranges.filter((_, i) => i !== index);
    form.setValue(namespaceRangesPath, newRanges);
    setRangeDrafts((current) =>
      shiftDraftKeysAfterRangeRemoval(current, index),
    );
  };

  return (
    <div className="my-3">
      <Checkbox
        size="lg"
        label="Namespace"
        description="Run mutually exclusive experiments"
        value={enabled}
        setValue={(v) => {
          form.setValue(namespaceEnabledPath, v);
        }}
      />
      {enabled && (
        <div className="box p-3 mb-2">
          <label>Use namespace</label>
          <SelectField
            value={namespace}
            onChange={(v) => {
              if (v === namespace) return;
              const selected = filteredNamespaces.find((n) => n.name === v);
              setRangeDrafts({});
              form.setValue(namespaceNamePath, v);

              // Set format from namespace definition so downstream consumers
              // (applyNamespaceToPayload, toExperimentApiInterface) can discriminate
              // between legacy and multiRange without relying on structural checks.
              form.setValue(
                namespaceFormatPath,
                selected?.format === "multiRange" ? "multiRange" : "legacy",
              );

              // Set hashAttribute from namespace
              if (
                selected &&
                "hashAttribute" in selected &&
                selected.hashAttribute
              ) {
                form.setValue(
                  namespaceHashAttributePath,
                  selected.hashAttribute,
                );
              }

              const initialGap = getLargestGap(
                findGaps(namespaceUsage, v, featureId, trackingKey),
              );

              // Always initialize with ranges array (single range by default)
              form.setValue(namespaceRangesPath, [
                [initialGap?.start || 0, initialGap?.end || 0],
              ]);
            }}
            placeholder="Choose a namespace..."
            options={namespaceOptions}
            sort={false}
          />
          {namespace && selectedNamespace && (
            <div className="mt-3">
              {selectedNamespace &&
                "hashAttribute" in selectedNamespace &&
                selectedNamespace.hashAttribute && (
                  <Callout status="info" mb="3">
                    <strong>Hash Attribute:</strong>{" "}
                    {`${selectedNamespace.hashAttribute}`}
                  </Callout>
                )}
              {selectedIsDifferentHash && (
                <Callout status="info" mb="3">
                  This namespace hash attribute differs from the experiment hash
                  attribute.
                </Callout>
              )}

              <NamespaceUsageGraph
                namespace={namespace}
                usage={data?.namespaces || {}}
                featureId={featureId}
                ranges={ranges.length > 0 ? ranges : undefined}
                title="Allocation"
                trackingKey={trackingKey}
              />

              <Box mt="3">
                <Flex justify="between" align="center" mb="2">
                  <label>Selected Range{ranges.length > 1 ? "s" : ""}</label>
                  {totalAllocation > 0 && (
                    <Badge
                      label={`Total: ${(totalAllocation * 100).toFixed(2)}%`}
                      color="blue"
                    />
                  )}
                </Flex>

                {ranges.map((range, index) => (
                  <Flex key={index} align="center" gap="2" mb="2">
                    <Field
                      type="number"
                      min={0}
                      max={1}
                      step=".01"
                      value={
                        rangeDrafts[getDraftKey(index, 0)] ?? `${range[0]}`
                      }
                      onChange={(e) => {
                        const rawValue = e.target.value;
                        setRangeDrafts((current) => ({
                          ...current,
                          [getDraftKey(index, 0)]: rawValue,
                        }));
                      }}
                      onBlur={(e) => {
                        commitDraftValue(index, 0, e.target.value);
                      }}
                    />
                    <Text>to</Text>
                    <Field
                      type="number"
                      min={0}
                      max={1}
                      step=".01"
                      value={
                        rangeDrafts[getDraftKey(index, 1)] ?? `${range[1]}`
                      }
                      onChange={(e) => {
                        const rawValue = e.target.value;
                        setRangeDrafts((current) => ({
                          ...current,
                          [getDraftKey(index, 1)]: rawValue,
                        }));
                      }}
                      onBlur={(e) => {
                        commitDraftValue(index, 1, e.target.value);
                      }}
                    />
                    <Text color="text-low">
                      ({((range[1] - range[0]) * 100).toFixed(2)}%)
                    </Text>
                    {ranges.length > 1 && (
                      <Button
                        color="red"
                        variant="soft"
                        size="xs"
                        onClick={() => removeRange(index)}
                      >
                        <FaTrash />
                      </Button>
                    )}
                  </Flex>
                ))}

                <Button
                  variant="outline"
                  onClick={addRange}
                  mt="2"
                  icon={<FaPlus />}
                >
                  Add Range
                </Button>
              </Box>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
