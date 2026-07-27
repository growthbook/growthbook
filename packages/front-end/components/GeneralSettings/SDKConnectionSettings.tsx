import { Box, Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { ConnectSettingsForm } from "@/pages/settings";
import Checkbox from "@/ui/Checkbox";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";

export default function SDKConnectionSettings() {
  const { hasCommercialFeature } = useUser();

  if (!hasCommercialFeature("require-project-for-sdk-connections-setting")) {
    return null;
  }

  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <Frame>
          <Flex gap="4">
            <Box width="220px" flexShrink="0">
              <Heading size="medium" as="h4">
                Project Scoping
              </Heading>
            </Box>

            <Flex align="start" direction="column" flexGrow="1" pt="6">
              <Box mb="4" width="100%">
                <Checkbox
                  id="toggle-requireProjectForSdkConnections"
                  label="Require Project for all new SDK Connections"
                  description="If enabled, users must select at least one Project when creating an SDK Connection. Existing project-less SDK Connections can still be updated until a Project is set."
                  value={!!watch("requireProjectForSdkConnections")}
                  setValue={(value) =>
                    setValue("requireProjectForSdkConnections", value, {
                      shouldDirty: true,
                    })
                  }
                />
              </Box>
            </Flex>
          </Flex>
        </Frame>
      )}
    </ConnectSettingsForm>
  );
}
