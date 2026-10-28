import { useUser } from "@/services/UserContext";
import { ConnectSettingsForm } from "@/components/GeneralSettings/ConnectSettingsForm";
import Checkbox from "@/ui/Checkbox";
import { SettingsGroup, UnsavedMark } from "./SettingsGroup";

export default function SDKConnectionSettings() {
  const { hasCommercialFeature } = useUser();

  if (!hasCommercialFeature("require-project-for-sdk-connections-setting")) {
    return null;
  }

  return (
    <ConnectSettingsForm>
      {({ watch, setValue }) => (
        <SettingsGroup
          id="sdk-scope"
          title="Project Scoping"
          description="Rules for new SDK Connections."
          keywords="sdk connection require project"
        >
          <UnsavedMark name="requireProjectForSdkConnections">
            <Checkbox
              id="toggle-requireProjectForSdkConnections"
              label="Require a Project for new SDK Connections"
              description="Existing Connections without a Project can still be edited until one is set."
              value={!!watch("requireProjectForSdkConnections")}
              setValue={(value) =>
                setValue("requireProjectForSdkConnections", value, {
                  shouldDirty: true,
                })
              }
            />
          </UnsavedMark>
        </SettingsGroup>
      )}
    </ConnectSettingsForm>
  );
}
