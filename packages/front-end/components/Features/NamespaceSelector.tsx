import { useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FaPlusCircle } from "react-icons/fa";
import { PiWarningCircle, PiXBold } from "react-icons/pi";
import omit from "lodash/omit";
import { Namespaces } from "shared/types/organization";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import useApi from "@/hooks/useApi";
import { useIncrementer } from "@/hooks/useIncrementer";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import useSDKConnections from "@/hooks/useSDKConnections";
import { findGaps } from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import NamespaceUsageGraph from "./NamespaceUsageGraph";
import {
  normalizeRangeAfterLowerChange,
  normalizeRangeAfterUpperChange,
  findContainingGap,
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
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasIncompatibleConnections = useMemo(
    () =>
      (sdkConnectionsData?.connections ?? []).some(
        (c) => !getConnectionSDKCapabilities(c).includes("namespacesV2"),
      ),
    [sdkConnectionsData],
  );
  const { namespaces } = useOrgSettings();
  const [rangeDrafts, setRangeDrafts] = useState<Record<string, string>>({});
  const [focusedRangeIndex, setFocusedRangeIndex] = useState<number | null>(
    null,
  );
  const [allowOverlap, setAllowOverlap] = useState(false);
  const [selectKey, forceSelectRemount] = useIncrementer();
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

    const filtered = isFallbackMode
      ? activeNamespaces.filter((n) => isLegacyNamespace(n))
      : activeNamespaces;

    return {
      filteredNamespaces: filtered,
      namespaceOptions: filtered.map((n) => {
        const isHashMismatch =
          !isFallbackMode &&
          !isLegacyNamespace(n) &&
          n.hashAttribute !== effectiveHashAttribute;
        return {
          value: n.name,
          label: n.label,
          isDisabled: isHashMismatch,
        };
      }) as SingleValue[],
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

  const isOverlapping = useMemo(() => {
    if (!namespace || ranges.length === 0) return false;
    return ranges.some(([start, end]) => {
      let remaining = start;
      const sorted = [...persistedGaps].sort((a, b) => a.start - b.start);
      for (const gap of sorted) {
        if (gap.start > remaining) return true;
        if (gap.end >= end) return false;
        remaining = gap.end;
      }
      return remaining < end;
    });
  }, [namespace, ranges, persistedGaps]);

  // Fires on namespace change or when API data first loads. The ref avoids
  // making isOverlapping itself a dep (which would fire on every range edit).
  const isOverlappingRef = useRef(isOverlapping);
  isOverlappingRef.current = isOverlapping;
  const isDataLoaded = !!data;
  useEffect(() => {
    setAllowOverlap(isOverlappingRef.current);
  }, [namespace, isDataLoaded]);

  const effectiveGaps = useMemo(
    () => (allowOverlap ? [{ start: 0, end: 1 }] : persistedGaps),
    [allowOverlap, persistedGaps],
  );

  const largestAvailableGap = useMemo(
    () => getLargestGap(subtractSelectedRangesFromGaps(effectiveGaps, ranges)),
    [effectiveGaps, ranges],
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
      effectiveGaps,
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
              const gaps = findGaps(namespaceUsage, v, featureId, trackingKey);
              const initialGap = getLargestGap(gaps);
              const namespaceFull = !cachedRanges?.length && !initialGap;
              // Namespace is 100% allocated — auto-enable overlap and default to full range.
              if (namespaceFull) setAllowOverlap(true);
              const initialRanges: RangeTuple[] =
                cachedRanges && cachedRanges.length > 0
                  ? cachedRanges
                  : namespaceFull
                    ? [[0, 1]]
                    : [[initialGap!.start, initialGap!.end]];

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
              const row = (
                <Flex as="div" align="baseline">
                  <span>{option.label}</span>
                  <Text size="small" color="text-mid" ml="auto">
                    {hashAttr ? (
                      <>
                        {option.isDisabled && (
                          <PiWarningCircle
                            size={15}
                            style={{
                              color: "var(--amber-9)",
                              verticalAlign: "-3px",
                              marginRight: 4,
                            }}
                          />
                        )}
                        hash attribute: <strong>{hashAttr}</strong>
                      </>
                    ) : (
                      <span style={{ opacity: 0.45 }}>legacy</span>
                    )}
                  </Text>
                </Flex>
              );
              if (!option.isDisabled) return row;
              return (
                <Tooltip content="Namespace and experiment hash attributes must match">
                  {row}
                </Tooltip>
              );
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
              {hasIncompatibleConnections &&
                selectedNamespace?.format === "multiRange" && (
                  <Callout status="warning" mb="3" size="sm">
                    Some of your SDK Connections may not support multi-range
                    namespaces.
                  </Callout>
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
                <Flex justify="between" align="center" mb="1">
                  <label>Selected range{ranges.length > 1 ? "s" : ""}</label>
                  <Checkbox
                    size="sm"
                    label="Allow overlap"
                    value={allowOverlap}
                    setValue={(v) => {
                      setAllowOverlap(v);
                      if (!v && ranges.length > 0) {
                        const snapped: RangeTuple[] = [];
                        for (let index = 0; index < ranges.length; index++) {
                          const range = ranges[index];
                          const otherRanges = [
                            ...snapped,
                            ...ranges.filter((_, i) => i > index),
                          ];
                          const available = subtractSelectedRangesFromGaps(
                            persistedGaps,
                            otherRanges,
                          );
                          if (findContainingGap(available, range[0])) {
                            snapped[index] = normalizeRangeAfterUpperChange(
                              range,
                              range[1],
                              available,
                            );
                          } else {
                            const largest = getLargestGap(available);
                            snapped[index] = largest
                              ? ([largest.start, largest.end] as RangeTuple)
                              : range;
                          }
                        }
                        form.setValue(namespaceRangesPath, snapped, {
                          shouldDirty: true,
                          shouldTouch: true,
                        });
                        setRangeDrafts({});
                      }
                    }}
                  />
                </Flex>

                {ranges.map((range, index) => {
                  const showDivider =
                    ranges.length > 1 && index < ranges.length - 1;
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
                            const normalized = normalizeRangeAfterLowerChange(
                              range,
                              parsed,
                              getAvailableGapsForRange(index),
                            );
                            setRangeAtIndex(index, normalized);
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
                            const normalized = normalizeRangeAfterUpperChange(
                              range,
                              parsed,
                              getAvailableGapsForRange(index),
                            );
                            setRangeAtIndex(index, normalized);
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
                          mr="2"
                          mt="4"
                          onClick={() => removeRange(index)}
                          aria-label="Remove range"
                        >
                          <PiXBold size={14} />
                        </IconButton>
                      )}
                    </Flex>
                  );
                })}

                {largestAvailableGap ? (
                  <Link onClick={addRange} mt="1">
                    <FaPlusCircle
                      style={{ verticalAlign: "-2px", marginRight: 6 }}
                    />
                    Add Range
                  </Link>
                ) : (
                  <HelperText status="info" mt="2" size="sm">
                    No space available in this namespace. Enable{" "}
                    <strong>Allow overlap</strong> above to assign a range
                    regardless.
                  </HelperText>
                )}
              </Box>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
