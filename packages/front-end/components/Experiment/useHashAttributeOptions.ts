import { useAttributeSchema } from "@/services/features";
import {
  type AttributeOptionForTooltip,
  toAttributeOption,
} from "@/components/Features/AttributeOptionTooltip";

// Only the flagged hash attributes when the org flags any. `current` stays even
// once archived or out of scope, so opening a picker can't silently drop it.
export default function useHashAttributeOptions(
  attributeProjects: string | string[] | null | undefined,
  current: string | undefined,
): AttributeOptionForTooltip[] {
  const attributeSchema = useAttributeSchema(false, attributeProjects);
  // Unfiltered (incl. archived) so a kept attribute still carries its metadata.
  const allAttributeSchema = useAttributeSchema(true);

  const hasHashAttributes = attributeSchema.some((x) => x.hashAttribute);
  const options: AttributeOptionForTooltip[] = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map(toAttributeOption);

  if (current && !options.find((o) => o.value === current)) {
    options.push(
      toAttributeOption({
        ...allAttributeSchema.find((s) => s.property === current),
        property: current,
      }),
    );
  }

  return options;
}
