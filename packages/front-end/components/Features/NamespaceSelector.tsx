import { useEffect, useMemo, useRef, useState } from "react";
import { UseFormReturn, useWatch } from "react-hook-form";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { FaPlusCircle, FaTimes } from "react-icons/fa";
import omit from "lodash/omit";
import { Namespaces } from "shared/types/organization";
import useApi from "@/hooks/useApi";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
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
  format?: "legacy" | "multiRange";
  hashAttribute?: string;
};

// Canonical shape we write into the form. Keeping this shape stable (no stray
// keys, no `range` tuple) is what lets `isEqual(watched, defaults)` reliably
// report real user changes instead of shape drift.
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
  // Remembers the user's ranges per-namespace for the lifetime of this modal
  // session so switching the namespace dropdown away and back restores their
  // picks instead of resetting to the largest-available gap.
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

    // Keep a namespace in the dropdown only if it still has room for this
    // experiment. `findGaps` already excludes the current featureId/trackingKey,
    // so a namespace the current experiment is allocated in keeps showing the
    // experiment's own range as a usable gap. We always keep the currently
    // selected namespace so the user can edit their existing range even if
    // others have since filled the namespace up.
    const hasAvailableRoom = (n: Namespaces) => {
      if (n.name === namespace) return true;
      const gaps = findGaps(namespaceUsage, n.name, featureId, trackingKey);
      return gaps.some((g) => g.end - g.start > 0);
    };
    const allocatable = activeNamespaces.filter(hasAvailableRoom);

    const filtered = isFallbackMode
      ? allocatable.filter((n) => isLegacyNamespace(n))
      : allocatable;
    const matchingNamespaces = allocatable.filter((n) => {
      if (isLegacyNamespace(n)) return true;
      return n.hashAttribute === effectiveHashAttribute;
    });
    const differentHashNamespaces = allocatable.filter((n) => {
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
      // selectedNamespace lookup uses the unfiltered active set so a namespace
      // that just filled up is still resolved (e.g. for the hash-attribute
      // callout) when this experiment is the one tied to it.
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
    // Reset to a canonical "enabled but unassigned" state so stale
    // hashAttribute/format values from a previously-selected namespace
    // can't leak into the persisted phase.
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
    // Fold the legacy single-range tuple into the canonical `ranges` array
    // and drop the legacy key so downstream diffs see a stable shape.
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

  // Persist the current namespace's ranges into the cache so switching the
  // dropdown away and back restores the latest user edits (not a fresh gap).
  useEffect(() => {
    if (namespace && ranges.length > 0) {
      namespaceRangesCache.current[namespace] = ranges;
    }
  }, [namespace, ranges]);

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
            // Enable with a canonical blank shape. Avoid mutating existing
            // fields so we don't accidentally resurrect stale keys.
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

              // Restore the user's previously-picked ranges for this namespace
              // if they've been here before in this session. Otherwise fall
              // back to the largest available gap.
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

              // Build the next form state as one canonical object so no stale
              // keys (e.g. hashAttribute from a previously-selected
              // multiRange namespace) can survive the switch.
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
            placeholder="Choose a namespace..."
            options={namespaceOptions}
            sort={false}
          />
          {namespace && selectedNamespace && (
            <div className="mt-3">
              {selectedNamespace &&
                "hashAttribute" in selectedNamespace &&
                selectedNamespace.hashAttribute && (
                  <Callout status="info" variant="surface" size="sm" mb="3">
                    Hash attribute:{`${selectedNamespace.hashAttribute}`}
                  </Callout>
                )}
              {selectedIsDifferentHash && (
                <Callout status="info" mb="3" variant="surface" size="sm">
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
                        ({Math.round((range[1] - range[0]) * 100)}%)
                      </Text>
                      <Box flexGrow="1" />
                      {ranges.length > 1 && (
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          onClick={() => removeRange(index)}
                          aria-label="Remove range"
                        >
                          <FaTimes />
                        </IconButton>
                      )}
                    </Flex>
                  );
                })}

                <Link onClick={addRange} mt="3">
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
