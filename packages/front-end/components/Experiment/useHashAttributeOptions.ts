import { useAttributeSchema } from "@/services/features";
import {
  type AttributeOptionForTooltip,
  toAttributeOption,
} from "@/components/Features/AttributeOptionTooltip";

/**
 * The attributes an experiment may bucket on. Where the org has marked some
 * attributes as hash attributes, only those are offered.
 *
 * `current` is kept in the list even when it no longer qualifies — archived, or
 * out of the experiment's projects since it was chosen — so opening a picker
 * can't silently drop what the experiment already uses.
 */
export default function useHashAttributeOptions(
  attributeProjects: string[] | null | undefined,
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
    const full = allAttributeSchema.find((s) => s.property === current);
    options.push({
      label: current,
      value: current,
      description: full?.description,
      tags: full?.tags,
      datatype: full?.datatype,
      hashAttribute: full?.hashAttribute,
      projects: full?.projects,
    });
  }

  return options;
}
