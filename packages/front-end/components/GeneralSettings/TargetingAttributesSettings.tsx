import { Box } from "@radix-ui/themes";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { useFormContext } from "react-hook-form";
import Checkbox from "@/ui/Checkbox";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { SettingsGroup, UnsavedMark } from "./SettingsGroup";

// The form always works with the canonical object shape
// ({ isOn, requireProjectScoping }). Legacy boolean values from older orgs
// are normalized to the object shape on hydrate in SettingsFormProvider, so
// by the time we reach this component the value is guaranteed to be the
// object form. `getRequireRegisteredAttributesSettings` is used as a belt-
// and-suspenders fallback in case `watch` returns undefined before hydrate.
export default function TargetingAttributesSettings() {
  const { watch, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();
  const { isOn, requireProjectScoping } =
    getRequireRegisteredAttributesSettings(
      watch("requireRegisteredAttributes"),
    );

  const update = (next: { isOn: boolean; requireProjectScoping: boolean }) => {
    setValue("requireRegisteredAttributes", next, { shouldDirty: true });
  };

  return (
    <SettingsGroup
      id="sdk-attrs"
      title="Targeting Attributes"
      description="Validation for attributes used in rules and experiments."
      keywords="targeting attributes registered schema project match"
    >
      <UnsavedMark name="requireRegisteredAttributes.isOn">
        <Checkbox
          id="toggle-requireRegisteredAttributes"
          label="Require registered attributes"
          description="Block rules and experiments that use attribute keys not listed under Targeting attributes."
          value={isOn}
          setValue={(value) => update({ isOn: !!value, requireProjectScoping })}
        />
      </UnsavedMark>
      {isOn && (
        <Box pl="5">
          <UnsavedMark name="requireRegisteredAttributes.requireProjectScoping">
            <Checkbox
              id="toggle-requireProjectScoping"
              label="Require Project match"
              description="Also block attributes that aren't scoped to the Projects the Feature Flag or experiment targets."
              value={requireProjectScoping}
              setValue={(value) =>
                update({ isOn, requireProjectScoping: !!value })
              }
            />
          </UnsavedMark>
        </Box>
      )}
    </SettingsGroup>
  );
}
