import { Box } from "@radix-ui/themes";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { ConnectSettingsForm } from "@/pages/settings";
import Checkbox from "@/ui/Checkbox";
import { SettingsGroup } from "./SettingsGroup";

// The form always works with the canonical object shape
// ({ isOn, requireProjectScoping }). Legacy boolean values from older orgs
// are normalized to the object shape on hydrate in SettingsFormProvider, so
// by the time we reach this component the value is guaranteed to be the
// object form. `getRequireRegisteredAttributesSettings` is used as a belt-
// and-suspenders fallback in case `watch` returns undefined before hydrate.
export default function TargetingAttributesSettings() {
  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => {
        const { isOn, requireProjectScoping } =
          getRequireRegisteredAttributesSettings(
            watch("requireRegisteredAttributes"),
          );

        const update = (next: {
          isOn: boolean;
          requireProjectScoping: boolean;
        }) => {
          setValue("requireRegisteredAttributes", next, { shouldDirty: true });
        };

        return (
          <SettingsGroup
            id="sdk-attrs"
            title="Targeting attributes"
            description="Validation for attributes used in rules and experiments."
            keywords="targeting attributes registered schema project match"
          >
            <Checkbox
              id="toggle-requireRegisteredAttributes"
              label="Require registered attributes"
              description="Block feature rules and experiments that use attribute keys not listed under Targeting Attributes."
              value={isOn}
              setValue={(value) =>
                update({ isOn: !!value, requireProjectScoping })
              }
            />
            {isOn && (
              <Box pl="5">
                <Checkbox
                  id="toggle-requireProjectScoping"
                  label="Require Project match"
                  description="Also block attributes that aren't scoped to the Projects the Feature Flag or experiment targets."
                  value={requireProjectScoping}
                  setValue={(value) =>
                    update({ isOn, requireProjectScoping: !!value })
                  }
                />
              </Box>
            )}
          </SettingsGroup>
        );
      }}
    </ConnectSettingsForm>
  );
}
