import { useForm } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { useState } from "react";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import track from "@/services/track";

export default function MetricGroupInlineForm({
  selectedMetricIds,
  datasource,
  mutateDefinitions,
  onChange,
  cancel,
}: {
  datasource: string;
  selectedMetricIds: string[];
  mutateDefinitions: () => Promise<void>;
  onChange: (metrics: string[]) => void;
  cancel: () => void;
}) {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const { apiCall } = useAuth();
  const form = useForm<{ name: string; metrics: string[]; datasource: string }>(
    {
      defaultValues: {
        name: "",
        datasource,
        metrics: selectedMetricIds,
      },
    },
  );

  const submit = form.handleSubmit(async () => {
    setError(undefined);
    setLoading(true);
    const value = {
      name: form.watch("name"),
      metrics: form.watch("metrics"),
      datasource: form.watch("datasource"),
    };
    track("Create Metric Group", {
      value,
      source: "Add New Experiment Modal",
    });
    try {
      const res = await apiCall<{
        status: 200;
        metricGroup: MetricGroupInterface;
      }>("/metric-group", {
        method: "POST",
        body: JSON.stringify(value),
      });
      await mutateDefinitions();

      onChange([res.metricGroup.id]);
    } catch (e) {
      track("Create Metric Group Error", {
        error: e.message,
        source: "Add New Experiment Modal",
        value,
      });
      setError(
        `Unable to save Metric Group. ${
          e.message ? `Reason:  ${e.message}` : ""
        }`,
      );
    }
    setLoading(false);
  });

  return (
    <div>
      <Flex align="center" className="pb-2">
        <Field
          disabled={loading}
          placeholder="Metric Group Name"
          style={{ minWidth: "320px" }}
          {...form.register("name")}
        />
        <span className="px-2">
          <Button onClick={() => submit()} loading={loading}>
            Save
          </Button>
        </span>
        <Button variant="ghost" color="red" disabled={loading} onClick={cancel}>
          Cancel
        </Button>
      </Flex>
      {error ? <Callout status="error">{error}</Callout> : null}
    </div>
  );
}
