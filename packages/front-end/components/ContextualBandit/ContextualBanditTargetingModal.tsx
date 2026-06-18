import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

type FormValues = {
  coveragePercent: number;
  condition: string;
  hashAttribute: string;
};

export default function ContextualBanditTargetingModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema(false, cb.project);

  const hashAttributes = useMemo(
    () =>
      attributeSchema?.filter((a) => a.hashAttribute).map((a) => a.property) ??
      [],
    [attributeSchema],
  );

  const form = useForm<FormValues>({
    defaultValues: {
      coveragePercent: Math.round((cb.coverage ?? 1) * 100),
      condition: cb.condition ?? "",
      hashAttribute:
        cb.hashAttribute ??
        (hashAttributes.includes("id") ? "id" : (hashAttributes[0] ?? "id")),
    },
  });

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-targeting"
      header="Edit Targeting"
      close={close}
      cta="Save"
      size="lg"
      submit={form.handleSubmit(async (data) => {
        const coverage = Math.min(1, Math.max(0, data.coveragePercent / 100));
        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({
            coverage,
            condition: data.condition,
            hashAttribute: data.hashAttribute || undefined,
          }),
        });
        mutate();
      })}
    >
      <Field
        label="Traffic Coverage (%)"
        type="number"
        min={0}
        max={100}
        {...form.register("coveragePercent", { valueAsNumber: true })}
        helpText="Percentage of eligible traffic included in the bandit."
      />

      <Field
        label="Targeting Condition (JSON)"
        textarea
        minRows={3}
        {...form.register("condition")}
        helpText={'Optional MongoDB-style condition, e.g. {"country": "US"}.'}
      />

      <hr className="my-4" />

      {hashAttributes.length > 0 ? (
        <SelectField
          label="Assignment Attribute"
          value={form.watch("hashAttribute")}
          onChange={(v) => form.setValue("hashAttribute", v)}
          options={hashAttributes.map((a) => ({ value: a, label: a }))}
          helpText="The user attribute used to assign variations."
        />
      ) : (
        <Field
          label="Assignment Attribute"
          {...form.register("hashAttribute")}
          helpText="The user attribute used to assign variations."
        />
      )}
    </ModalStandard>
  );
}
