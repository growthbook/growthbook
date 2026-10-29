import { useFormContext } from "react-hook-form";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import { formatAttributeOptionLabel } from "@/components/Features/AttributeOptionTooltip";
import useHashAttributeOptions from "@/components/Experiment/useHashAttributeOptions";

/**
 * Assignment-attribute (`hashAttribute`) picker shared by the CB creation form
 * and the Traffic & Targeting edit modal. Reads/writes the `hashAttribute`
 * field via the surrounding `FormProvider`.
 */
export default function ContextualBanditAssignmentAttributeSelect({
  project,
  label = "Assign Variation by Attribute",
}: {
  project?: string;
  label?: string;
}) {
  const form = useFormContext();
  const hashAttributeOptions = useHashAttributeOptions(
    project,
    form.watch("hashAttribute"),
  );

  return (
    <div className="mb-4">
      <Text as="label" weight="semibold" mb="1">
        {label}
      </Text>
      <SelectField
        withRadixThemedPortal
        containerClassName="flex-1"
        options={hashAttributeOptions}
        value={form.watch("hashAttribute") ?? ""}
        onChange={(v) => {
          form.setValue("hashAttribute", v);
        }}
        formatOptionLabel={formatAttributeOptionLabel}
      />
    </div>
  );
}
