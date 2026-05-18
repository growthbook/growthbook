import { Box, Flex } from "@radix-ui/themes";
import { getRequireRegisteredAttributesSettings } from "shared/util";
import { ConnectSettingsForm } from "@/pages/settings";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";

// The form always works with the canonical object shape
// ({ isOn, requireProjectScoping }). Legacy boolean values from older orgs
// are normalized to the object shape on hydrate in pages/settings/index.tsx,
// so by the time we reach this component the value is guaranteed to be the
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
          <Frame>
            <Flex gap="4">
              <Box width="220px" flexShrink="0">
                <Heading size="medium" as="h4">
                  Targeting Attributes
                </Heading>
              </Box>

              <Flex align="start" direction="column" flexGrow="1" pt="6">
                <Box mb="3" width="100%">
                  <Heading size="small" as="h5" mb="0">
                    Attribute Validation
                  </Heading>
                </Box>
                <Box mb="4" width="100%">
                  <Checkbox
                    id="toggle-requireRegisteredAttributes"
                    label="Require registered attributes"
                    description="Block feature rules and experiments that use attribute keys not listed under Targeting Attributes."
                    value={isOn}
                    setValue={(value) =>
                      update({ isOn: !!value, requireProjectScoping })
                    }
                  />
                </Box>
                {isOn && (
                  <Box mb="2" width="100%" pl="5">
                    <Checkbox
                      id="toggle-requireProjectScoping"
                      label="Require project match"
                      description="Also block attributes that aren't scoped to the rule's project."
                      value={requireProjectScoping}
                      setValue={(value) =>
                        update({ isOn, requireProjectScoping: !!value })
                      }
                    />
                  </Box>
                )}
              </Flex>
            </Flex>
          </Frame>
        );
      }}
    </ConnectSettingsForm>
  );
}
