import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import { ConnectSettingsForm } from "@/pages/settings";
import Frame from "@/ui/Frame";
import { hasFileConfig } from "@/services/env";

export default function SavedGroupSettings() {
  return (
    <ConnectSettingsForm>
      {({ register }) => (
        <Frame id="settings-saved-groups">
          <Flex gap="4">
            <Box width="220px" flexShrink="0">
              <Heading size="4" as="h4">
                Saved Group Settings
              </Heading>
            </Box>

            <Flex align="start" direction="column" flexGrow="1" pt="6">
              <Box mb="6" width="100%" mt="2">
                <Text as="label" className="font-weight-semibold" size="3">
                  ID List Size Limit
                </Text>
                <Box width="200px">
                  <Field
                    type="number"
                    min="1"
                    step="1"
                    disabled={hasFileConfig()}
                    {...register("savedGroupSizeLimit", {
                      valueAsNumber: true,
                      min: 1,
                    })}
                  />
                </Box>
                <p>
                  <small className="text-muted mb-3">
                    Limiting the number of items in an ID List can prevent SDK
                    payloads from growing too large. Admins and users with the{" "}
                    <i>Saved Groups Bypass Size Limit</i> policy can bypass this
                    limit manually
                  </small>
                </p>
              </Box>
            </Flex>
          </Flex>
        </Frame>
      )}
    </ConnectSettingsForm>
  );
}
