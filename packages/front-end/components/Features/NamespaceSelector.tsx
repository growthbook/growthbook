import { UseFormReturn } from "react-hook-form";
import useApi from "@/hooks/useApi";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import NamespaceUsageGraph from "./NamespaceUsageGraph";

export interface Props {
  featureId: string;
  trackingKey?: string;
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  formPrefix?: string;
}

export default function NamespaceSelector({
  form,
  featureId,
  formPrefix = "",
  trackingKey = "",
}: Props) {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`,
  );
  const { namespaces } = useOrgSettings();

  const namespace = form.watch(`${formPrefix}namespace.name`);
  const enabled = form.watch(`${formPrefix}namespace.enabled`);

  if (!data || error || !namespaces?.length) return null;

  const range: [number, number] = [
    form.watch(`${formPrefix}namespace.range.0`) || 0,
    form.watch(`${formPrefix}namespace.range.1`) || 0,
  ];

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
              form.setValue(`${formPrefix}namespace.name`, v);

              const largestGap = findGaps(
                data?.namespaces || {},
                v,
                featureId,
                trackingKey,
              ).sort((a, b) => b.end - b.start - (a.end - a.start))[0];

              form.setValue(
                `${formPrefix}namespace.range.0`,
                largestGap?.start || 0,
              );
              form.setValue(
                `${formPrefix}namespace.range.1`,
                largestGap?.end || 0,
              );
            }}
            placeholder="Choose a namespace..."
            options={namespaces
              .filter((n) => {
                return n?.status !== "inactive";
              })
              .map((n) => ({ value: n.name, label: n.label }))}
          />
          {namespace &&
            namespaces.filter((n) => n.name === namespace).length > 0 && (
              <div className="mt-3">
                <NamespaceUsageGraph
                  namespace={namespace}
                  usage={data?.namespaces || {}}
                  featureId={featureId}
                  range={range}
                  setRange={(range) => {
                    form.setValue(`${formPrefix}namespace.range.0`, range[0]);
                    form.setValue(`${formPrefix}namespace.range.1`, range[1]);
                  }}
                  title="Allocation"
                  trackingKey={trackingKey}
                />
                <div className="row align-items-center pt-4">
                  <div className="col-auto">
                    <label className="mb-0">Selected Range</label>
                  </div>
                  <div className="col-auto">
                    <div className="selected-value text-center">
                      {range[0].toFixed(2)}
                    </div>
                    <Field
                      type="range"
                      min={0}
                      max={range[1]}
                      step=".01"
                      {...form.register(`${formPrefix}namespace.range.0`, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                  <div className="col-auto">to</div>
                  <div className="col-auto">
                    <div className="selected-value text-center">
                      {range[1].toFixed(2)}
                    </div>
                    <Field
                      type="range"
                      min={range[0]}
                      max={1}
                      step=".01"
                      {...form.register(`${formPrefix}namespace.range.1`, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
