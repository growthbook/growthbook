import { useFormContext } from "react-hook-form";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import { useAttributeSchema } from "@/services/features";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";

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
  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    (attributeSchema?.filter((a) => a.hashAttribute)?.length ?? 0) > 0;

  return (
    <div className="mb-4">
      <Text as="label" weight="semibold" mb="1">
        {label}
      </Text>
      <SelectField
        withRadixThemedPortal
        containerClassName="flex-1"
        options={attributeSchema
          .filter((s) => !hasHashAttributes || s.hashAttribute)
          .map((s) => ({
            label: s.property,
            value: s.property,
            description: s.description,
            tags: s.tags,
            datatype: s.datatype,
            hashAttribute: s.hashAttribute,
          }))}
        value={form.watch("hashAttribute") ?? ""}
        onChange={(v) => {
          form.setValue("hashAttribute", v);
        }}
        formatOptionLabel={(o, meta) => (
          <AttributeOptionWithTooltip
            option={o as AttributeOptionForTooltip}
            context={meta.context}
          >
            {o.label}
          </AttributeOptionWithTooltip>
        )}
      />
    </div>
  );
}
