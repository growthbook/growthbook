import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { Separator } from "@radix-ui/themes";
import { FaPlus, FaTrash } from "react-icons/fa";
import { Namespaces } from "shared/types/organization";
import useApi from "@/hooks/useApi";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import Button from "@/components/Button";
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
  const separatorOptionValue = "__namespace-hash-separator__";
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

  const filteredNamespaces = isFallbackMode
    ? activeNamespaces.filter((n) => isLegacyNamespace(n))
    : activeNamespaces;

  const namespaceOptions: SingleValue[] = isFallbackMode
    ? filteredNamespaces.map((n) => ({ value: n.name, label: n.label }))
    : [
        ...matchingNamespaces.map((n) => ({
          value: n.name,
          label: n.label,
        })),
        ...(differentHashNamespaces.length
          ? [
              {
                value: separatorOptionValue,
                label: "Different hash attribute",
              },
              ...differentHashNamespaces.map((n) => ({
                value: n.name,
                label: n.label,
              })),
            ]
          : []),
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
            isOptionDisabled={(option) => {
              return "value" in option && option.value === separatorOptionValue;
            }}
            formatOptionLabel={(option) => {
              if (option.value !== separatorOptionValue) {
                return option.label;
              }
              return (
                <div className="py-1">
                  <Separator size="4" />
                </div>
              );
            }}
          />
          {namespace && selectedNamespace && (
            <div className="mt-3">
              {selectedNamespace &&
                "hashAttribute" in selectedNamespace &&
                selectedNamespace.hashAttribute && (
                  <div className="alert alert-info mb-3">
                    <strong>Hash Attribute:</strong>{" "}
                    {`${selectedNamespace.hashAttribute}`}
                  </div>
                )}
              {selectedIsDifferentHash && (
                <div className="alert alert-info mb-3">
                  This namespace hash attribute differs from the experiment hash
                  attribute.
                </div>
              )}

              <NamespaceUsageGraph
                namespace={namespace}
                usage={data?.namespaces || {}}
                featureId={featureId}
                ranges={ranges.length > 0 ? ranges : undefined}
                title="Allocation"
                trackingKey={trackingKey}
              />

              <div className="mt-3">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <label className="mb-0">
                    Selected Range{ranges.length > 1 ? "s" : ""}
                  </label>
                  {totalAllocation > 0 && (
                    <span className="badge badge-primary">
                      Total: {(totalAllocation * 100).toFixed(2)}%
                    </span>
                  )}
                </div>

                {ranges.map((range, index) => (
                  <div key={index} className="row align-items-center mb-2">
                    <div className="col-auto">
                      <Field
                        type="number"
                        min={0}
                        max={range[1]}
                        step=".01"
                        value={range[0]}
                        onChange={(e) => {
                          updateRange(
                            index,
                            0,
                            parseFloat(e.target.value) || 0,
                          );
                        }}
                      />
                    </div>
                    <div className="col-auto">to</div>
                    <div className="col-auto">
                      <Field
                        type="number"
                        min={range[0]}
                        max={1}
                        step=".01"
                        value={range[1]}
                        onChange={(e) => {
                          updateRange(
                            index,
                            1,
                            parseFloat(e.target.value) || 0,
                          );
                        }}
                      />
                    </div>
                    <div className="col-auto">
                      <span className="text-muted">
                        ({((range[1] - range[0]) * 100).toFixed(2)}%)
                      </span>
                    </div>
                    {ranges.length > 1 && (
                      <div className="col-auto">
                        <Button
                          color="red"
                          onClick={() => removeRange(index)}
                          className="btn-sm"
                        >
                          <FaTrash />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                <Button
                  color="outline-primary"
                  onClick={addRange}
                  className="btn-sm mt-2"
                >
                  <FaPlus className="mr-1" /> Add Range
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
