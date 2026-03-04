import { useEffect, useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
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

export interface Props {
  featureId: string;
  trackingKey?: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  formPrefix?: string;
  experimentHashAttribute?: string;
  fallbackAttribute?: string;
}

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

  const namespace = form.watch(`${formPrefix}namespace.name`);
  const enabled = form.watch(`${formPrefix}namespace.enabled`);

  // Get ranges - check both formats
  let ranges: [number, number][] =
    form.watch(`${formPrefix}namespace.ranges`) || [];

  // If no ranges but has old single range format, convert it
  if (ranges.length === 0) {
    const oldRange = form.watch(`${formPrefix}namespace.range`);
    if (oldRange && Array.isArray(oldRange) && oldRange.length === 2) {
      ranges = [oldRange as [number, number]];
      // Update form to use new format
      form.setValue(`${formPrefix}namespace.ranges`, ranges);
    }
  }

  //const hasMultipleRanges = ranges.length > 1;
  const allNamespaces = namespaces || [];
  const selectedNamespace = allNamespaces.find((n) => n.name === namespace);
  const effectiveHashAttribute =
    experimentHashAttribute || form.watch("hashAttribute") || "";
  const effectiveFallbackAttribute =
    fallbackAttribute ?? form.watch("fallbackAttribute") ?? "";
  const isFallbackMode = !!effectiveFallbackAttribute.trim();

  const activeNamespaces = allNamespaces.filter(
    (n) => n?.status !== "inactive",
  );
  const isLegacyNamespace = (n: Namespaces) => n.format !== "multiRange";

  const matchingNamespaces = activeNamespaces.filter((n) => {
    if (isLegacyNamespace(n)) return true;
    return n.hashAttribute === effectiveHashAttribute;
  });

  const differentHashNamespaces = activeNamespaces.filter((n) => {
    if (isLegacyNamespace(n)) return false;
    return n.hashAttribute !== effectiveHashAttribute;
  });

  // Memoize so the array reference only changes when the filter criteria actually
  // change, preventing the useEffect below from firing on every render.
  const filteredNamespaces = useMemo(() => {
    const active = (namespaces || []).filter((n) => n?.status !== "inactive");
    return isFallbackMode ? active.filter((n) => isLegacyNamespace(n)) : active;
  }, [isFallbackMode, namespaces]);

  const namespaceOptions: SingleValue[] = isFallbackMode
    ? filteredNamespaces.map((n) => ({ value: n.name, label: n.label }))
    : [
        ...matchingNamespaces.map((n) => ({ value: n.name, label: n.label })),
        ...differentHashNamespaces.map((n) => ({
          value: n.name,
          label: n.label,
        })),
      ];

  const selectedIsDifferentHash =
    !isFallbackMode &&
    !!selectedNamespace &&
    selectedNamespace.format === "multiRange" &&
    selectedNamespace.hashAttribute !== effectiveHashAttribute;

  useEffect(() => {
    if (!namespace) return;
    const existsInFiltered = filteredNamespaces.some(
      (n) => n.name === namespace,
    );
    if (existsInFiltered) return;
    form.setValue(`${formPrefix}namespace.name`, "");
    form.setValue(`${formPrefix}namespace.ranges`, []);
  }, [filteredNamespaces, form, formPrefix, namespace]);

  if (!data || error || !allNamespaces.length) return null;

  // Calculate total allocation percentage
  const totalAllocation = ranges.reduce(
    (sum, [start, end]) => sum + (end - start),
    0,
  );

  const addRange = () => {
    const gaps = findGaps(
      data?.namespaces || {},
      namespace,
      featureId,
      trackingKey,
    ).sort((a, b) => b.end - b.start - (a.end - a.start));

    const largestGap = gaps[0];
    if (largestGap) {
      const newRanges = [
        ...ranges,
        [largestGap.start, largestGap.end] as [number, number],
      ];
      form.setValue(`${formPrefix}namespace.ranges`, newRanges);
    }
  };

  const removeRange = (index: number) => {
    const newRanges = ranges.filter((_, i) => i !== index);
    form.setValue(`${formPrefix}namespace.ranges`, newRanges);
  };

  const updateRange = (index: number, field: 0 | 1, value: number) => {
    const newRanges = ranges.map((r, i) =>
      i === index ? ([...r] as [number, number]) : r,
    );
    newRanges[index][field] = value;
    form.setValue(`${formPrefix}namespace.ranges`, newRanges);
  };

  return (
    <div className="my-3">
      <Checkbox
        size="lg"
        label="Namespace"
        description="Run mutually exclusive experiments"
        value={enabled}
        setValue={(v) => {
          form.setValue(`${formPrefix}namespace.enabled`, v);
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
              form.setValue(`${formPrefix}namespace.name`, v);

              // Set format from namespace definition so downstream consumers
              // (applyNamespaceToRule, toExperimentApiInterface) can discriminate
              // between legacy and multiRange without relying on structural checks.
              form.setValue(
                `${formPrefix}namespace.format`,
                selected?.format === "multiRange" ? "multiRange" : "legacy",
              );

              // Set hashAttribute from namespace
              if (
                selected &&
                "hashAttribute" in selected &&
                selected.hashAttribute
              ) {
                form.setValue(
                  `${formPrefix}namespace.hashAttribute`,
                  selected.hashAttribute,
                );
              }

              // Find largest gap for initial range
              const largestGap = findGaps(
                data?.namespaces || {},
                v,
                featureId,
                trackingKey,
              ).sort((a, b) => b.end - b.start - (a.end - a.start))[0];

              // Always initialize with ranges array (single range by default)
              form.setValue(`${formPrefix}namespace.ranges`, [
                [largestGap?.start || 0, largestGap?.end || 0],
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
                      max={range[1]}
                      step=".01"
                      value={range[0]}
                      onChange={(e) => {
                        updateRange(index, 0, parseFloat(e.target.value) || 0);
                      }}
                    />
                    <Text>to</Text>
                    <Field
                      type="number"
                      min={range[0]}
                      max={1}
                      step=".01"
                      value={range[1]}
                      onChange={(e) => {
                        updateRange(index, 1, parseFloat(e.target.value) || 0);
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
