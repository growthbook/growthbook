import { UseFormReturn } from "react-hook-form";
import useApi from "@/hooks/useApi";
import { NamespaceApiResponse } from "@/pages/namespaces";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import Toggle from "@/components/Forms/Toggle";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
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
    `/organization/namespaces`
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
    <div className="form-group mb-4">
      <label>Target by Namespace</label>

      <div>
        <div className="mt-1 mb-2 d-flex align-items-center mx-1">
          <div>
            <Toggle
              id={"namepsacetoggle"}
              value={enabled}
              setValue={(v) => {
                form.setValue(`${formPrefix}namespace.enabled`, v);
              }}
            />{" "}
            Enable Namespace
          </div>
          <div className="flex-1" />
          <small className="text-muted">
            Namespaces allow you to run mutually exclusive experiments
          </small>
          <div></div>
        </div>
        {enabled && (
          <div className="mt-2 bg-light p-3 mb-2">
            <label>Namespace</label>
            <SelectField
              value={namespace}
              onChange={(v) => {
                if (v === namespace) return;
                form.setValue(`${formPrefix}namespace.name`, v);

                const largestGap = findGaps(
                  data?.namespaces || {},
                  v,
                  featureId,
                  trackingKey
                ).sort((a, b) => b.end - b.start - (a.end - a.start))[0];

                form.setValue(
                  `${formPrefix}namespace.range.0`,
                  largestGap?.start || 0
                );
                form.setValue(
                  `${formPrefix}namespace.range.1`,
                  largestGap?.end || 0
                );
              }}
              placeholder="Choose a namespace..."
              options={namespaces
                .filter((n) => {
                  return n?.status !== "inactive";
                })
                .map((n) => {
                  console.log(n);
                  return { value: n.name, label: n.label };
                })}
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
                  <div className="row align-items-center pt-2">
                    <div className="col-auto">
                      <label className="mb-0">Selected Range</label>
                    </div>
                    <div className="col-auto">
                      <Field
                        type="number"
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
                      <Field
                        type="number"
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
    </div>
  );
}
