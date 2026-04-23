import { useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import { PiWarningCircle, PiXBold } from "react-icons/pi";
import omit from "lodash/omit";
import { Namespaces } from "shared/types/organization";
import useApi from "@/hooks/useApi";
import { useIncrementer } from "@/hooks/useIncrementer";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
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
  format?: "legacy" | "multiRange";
  hashAttribute?: string;
};

// Stable shape written to the form — no stray keys, no legacy `range` tuple.
type CanonicalNamespace =
  | {
      enabled: true;
      name: string;
      format: "legacy";
      ranges: RangeTuple[];
    }
  | {
      enabled: true;
      name: string;
      format: "multiRange";
      hashAttribute: string;
      ranges: RangeTuple[];
    }
  | {
      enabled: false;
      name: "";
      format: "legacy";
      ranges: RangeTuple[];
    };

const DISABLED_NAMESPACE: CanonicalNamespace = {
  enabled: false,
  name: "",
  format: "legacy",
  ranges: [],
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
  const [focusedRangeIndex, setFocusedRangeIndex] = useState<number | null>(
    null,
  );
  const [selectKey, forceSelectRemount] = useIncrementer();
  // Per-namespace range cache: restores user picks when switching the dropdown away and back.
  const namespaceRangesCache = useRef<Record<string, RangeTuple[]>>({});
  const namespacePath = `${formPrefix}namespace`;
  const namespaceRangesPath = `${namespacePath}.ranges`;

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

    // Always keep the selected namespace regardless of room so edits still work.
    // findGaps excludes featureId/trackingKey so the current experiment's own
    // range doesn't count against available capacity.
    const roomSet = new Set(
      activeNamespaces
        .filter((n) => {
          if (n.name === namespace) return true;
          const gaps = findGaps(namespaceUsage, n.name, featureId, trackingKey);
          return gaps.some((g) => g.end - g.start > 0);
        })
        .map((n) => n.name),
    );
    const allocatable = activeNamespaces.filter((n) => roomSet.has(n.name));

    const filtered = isFallbackMode
      ? allocatable.filter((n) => isLegacyNamespace(n))
      : allocatable;

    const optionSource = isFallbackMode ? filtered : activeNamespaces;

    return {
      filteredNamespaces: filtered,
      namespaceOptions: optionSource.map((n) => {
        const isFull = !roomSet.has(n.name);
        const isHashMismatch =
          !isFallbackMode &&
          !isLegacyNamespace(n) &&
          n.hashAttribute !== effectiveHashAttribute;
        return {
          value: n.name,
          label: n.label,
          isDisabled: isFull || isHashMismatch,
          ...(isFull ? { tooltip: "full" } : {}),
        };
      }) as SingleValue[],
      // Use the unfiltered active set so a full namespace still resolves when
      // the current experiment is the one occupying all its space.
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
  }, [
    allNamespaces,
    effectiveHashAttribute,
    isFallbackMode,
    namespace,
    namespaceUsage,
    featureId,
    trackingKey,
  ]);

  const persistedGaps = useMemo(
    () => findGaps(namespaceUsage, namespace, featureId, trackingKey),
    [namespaceUsage, namespace, featureId, trackingKey],
  );
  const largestAvailableGap = useMemo(
    () => getLargestGap(subtractSelectedRangesFromGaps(persistedGaps, ranges)),
    [persistedGaps, ranges],
  );

  const getDraftKey = (index: number, field: 0 | 1) => `${index}:${field}`;

  useEffect(() => {
    if (!namespace) return;
    const existsInFiltered = filteredNamespaces.some(
      (n) => n.name === namespace,
    );
    if (existsInFiltered) return;
    form.setValue(
      namespacePath,
      {
        enabled,
        name: "",
        format: "legacy",
        ranges: [],
      } satisfies NamespaceFormState,
      { shouldDirty: true, shouldTouch: true },
    );
    setRangeDrafts({});
  }, [enabled, filteredNamespaces, form, namespace, namespacePath]);

  useEffect(() => {
    if (storedRanges.length > 0 || !legacyRange) return;
    // Migrate legacy single-range tuple → canonical `ranges` array.
    const current =
      (form.getValues(namespacePath) as NamespaceFormState | undefined) ?? {};
    form.setValue(
      namespacePath,
      { ...omit(current, "range"), ranges: [legacyRange] },
      { shouldDirty: false, shouldTouch: false },
    );
  }, [form, legacyRange, namespacePath, storedRanges.length]);

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

  useEffect(() => {
    if (namespace && ranges.length > 0) {
      namespaceRangesCache.current[namespace] = ranges;
    }
  }, [namespace, ranges]);

  // Clear namespace when the experiment's hash attribute changes and no longer matches.
  useEffect(() => {
    if (!experimentHashAttribute) return;
    const ns = form.getValues(namespacePath) as NamespaceFormState | undefined;
    const nsName = ns?.name;
    if (!nsName) return;
    const selected = allNamespaces.find((n) => n.name === nsName);
    if (!selected || selected.format !== "multiRange") return;
    if (selected.hashAttribute === experimentHashAttribute) return;
    form.setValue(
      namespacePath,
      {
        enabled: !!ns?.enabled,
        name: "",
        format: "legacy",
        ranges: [],
      } satisfies NamespaceFormState,
      { shouldDirty: true, shouldTouch: true },
    );
    setRangeDrafts({});
    forceSelectRemount();
  }, [
    experimentHashAttribute,
    allNamespaces,
    form,
    namespacePath,
    forceSelectRemount,
  ]);

  const getAvailableGapsForRange = (index: number) => {
    return subtractSelectedRangesFromGaps(
      persistedGaps,
      ranges.filter((_, rangeIndex) => rangeIndex !== index),
    );
  };

  const setRangeAtIndex = (index: number, nextRange: RangeTuple) => {
    const newRanges = ranges.map((r, i) => (i === index ? nextRange : r));
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
        mb="2"
        setValue={(v) => {
          if (v) {
            form.setValue(
              namespacePath,
              {
                enabled: true,
                name: namespace || "",
                format: "legacy",
                ranges: [],
              } satisfies NamespaceFormState,
              { shouldDirty: true, shouldTouch: true },
            );
          } else {
            form.setValue(namespacePath, DISABLED_NAMESPACE, {
              shouldDirty: true,
              shouldTouch: true,
            });
            setRangeDrafts({});
          }
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

              const cachedRanges = namespaceRangesCache.current[v];
              const initialRanges: RangeTuple[] =
                cachedRanges && cachedRanges.length > 0
                  ? cachedRanges
                  : (() => {
                      const initialGap = getLargestGap(
                        findGaps(namespaceUsage, v, featureId, trackingKey),
                      );
                      return [
                        [
                          initialGap?.start || 0,
                          initialGap?.end || 0,
                        ] as RangeTuple,
                      ];
                    })();

              const nextNs: NamespaceFormState =
                selected?.format === "multiRange"
                  ? {
                      enabled: true,
                      name: v,
                      format: "multiRange",
                      hashAttribute: selected.hashAttribute,
                      ranges: initialRanges,
                    }
                  : {
                      enabled: true,
                      name: v,
                      format: "legacy",
                      ranges: initialRanges,
                    };

              form.setValue(namespacePath, nextNs, {
                shouldDirty: true,
                shouldTouch: true,
              });
            }}
            key={selectKey}
            placeholder="Choose a namespace..."
            options={namespaceOptions}
            sort={false}
            formatOptionLabel={(option) => {
              const ns = allNamespaces.find((n) => n.name === option.value);
              const hashAttr =
                ns?.format === "multiRange" ? ns.hashAttribute : null;
              const isFull = option.tooltip === "full";
              const isDisabled = option.isDisabled;
              const tooltipContent = isFull
                ? "This namespace is full"
                : "Namespace and experiment hash attributes must match";
              const row = (
                <Flex as="div" align="baseline">
                  <span>{option.label}</span>
                  {(hashAttr || isFull) && (
                    <Text size="small" color="text-mid" ml="auto">
                      {isDisabled && (
                        <PiWarningCircle
                          size={15}
                          style={{
                            color: "var(--amber-9)",
                            verticalAlign: "-3px",
                            marginRight: 4,
                          }}
                        />
                      )}
                      {isFull ? (
                        "full"
                      ) : (
                        <>
                          hash attribute: <strong>{hashAttr}</strong>
                        </>
                      )}
                    </Text>
                  )}
                </Flex>
              );
              if (!isDisabled) return row;
              return <Tooltip content={tooltipContent}>{row}</Tooltip>;
            }}
          />
          {namespace && selectedNamespace && (
            <div className="mt-3">
              {selectedIsDifferentHash && (
                <HelperText status="warning" mb="3" size="sm">
                  This namespace hash attribute differs from the experiment hash
                  attribute.
                </HelperText>
              )}

              <NamespaceUsageGraph
                namespace={namespace}
                usage={data?.namespaces || {}}
                featureId={featureId}
                ranges={ranges.length > 0 ? ranges : undefined}
                focusedRangeIndex={focusedRangeIndex}
                title="Allocation"
                trackingKey={trackingKey}
              />

              <Box mt="4">
                <Flex justify="between" align="center" mb="3">
                  <label>Selected range{ranges.length > 1 ? "s" : ""}</label>
                </Flex>

                {ranges.map((range, index) => {
                  const showDivider = ranges.length > 1;
                  return (
                    <Flex
                      key={index}
                      align="center"
                      gap="3"
                      pb={showDivider ? "3" : "0"}
                      mb={showDivider ? "3" : "2"}
                      style={
                        showDivider
                          ? { borderBottom: "1px solid var(--gray-a5)" }
                          : undefined
                      }
                    >
                      <Field
                        type="number"
                        min={0}
                        max={1}
                        step=".01"
                        style={{ width: 90 }}
                        value={
                          rangeDrafts[getDraftKey(index, 0)] ?? `${range[0]}`
                        }
                        onChange={(e) => {
                          const rawValue = e.target.value;
                          setRangeDrafts((current) => ({
                            ...current,
                            [getDraftKey(index, 0)]: rawValue,
                          }));
                          const parsed = Number.parseFloat(rawValue);
                          if (!Number.isNaN(parsed)) {
                            setRangeAtIndex(index, [parsed, range[1]]);
                          }
                        }}
                        onFocus={(e) => {
                          e.target.select();
                          setFocusedRangeIndex(index);
                        }}
                        onBlur={(e) => {
                          commitDraftValue(index, 0, e.target.value);
                          setFocusedRangeIndex(null);
                        }}
                      />
                      <Text>to</Text>
                      <Field
                        type="number"
                        min={0}
                        max={1}
                        step=".01"
                        style={{ width: 90 }}
                        value={
                          rangeDrafts[getDraftKey(index, 1)] ?? `${range[1]}`
                        }
                        onChange={(e) => {
                          const rawValue = e.target.value;
                          setRangeDrafts((current) => ({
                            ...current,
                            [getDraftKey(index, 1)]: rawValue,
                          }));
                          const parsed = Number.parseFloat(rawValue);
                          if (!Number.isNaN(parsed)) {
                            setRangeAtIndex(index, [range[0], parsed]);
                          }
                        }}
                        onFocus={(e) => {
                          e.target.select();
                          setFocusedRangeIndex(index);
                        }}
                        onBlur={(e) => {
                          commitDraftValue(index, 1, e.target.value);
                          setFocusedRangeIndex(null);
                        }}
                      />
                      <Text color="text-low">
                        ({Math.round((range[1] - range[0]) * 100)}%)
                      </Text>
                      <Box flexGrow="1" />
                      {ranges.length > 1 && (
                        <IconButton
                          type="button"
                          variant="ghost"
                          color="red"
                          radius="full"
                          size="2"
                          onClick={() => removeRange(index)}
                          aria-label="Remove range"
                        >
                          <PiXBold size={14} />
                        </IconButton>
                      )}
                    </Flex>
                  );
                })}

                <Link onClick={addRange} mt="1">
                  <FaPlusCircle
                    style={{ verticalAlign: "-2px", marginRight: 6 }}
                  />
                  Add Range
                </Link>
              </Box>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
