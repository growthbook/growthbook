import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { SettingsGroup, UnsavedMark } from "./SettingsGroup";

// Self-hosted only: the server doesn't offer it on Cloud.
function RebuildSDKPayloads() {
  const { apiCall } = useAuth();
  const canManage = usePermissionsUtil().canManageOrgSettings();
  const [rebuilt, setRebuilt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsGroup
      id="sdk-payloads"
      title="SDK Payloads"
      description="Rebuild the payload of every SDK Connection, for example after changing an environment variable."
      keywords="sdk payload cache rebuild refresh"
    >
      {error ? <Callout status="error">{error}</Callout> : null}
      {rebuilt !== null ? (
        <Callout status="success">
          {`Rebuilt the payload of ${rebuilt} SDK Connection${rebuilt === 1 ? "" : "s"}.`}
        </Callout>
      ) : null}
      <Box>
        <Button
          variant="outline"
          disabled={!canManage}
          setError={setError}
          onClick={async () => {
            setRebuilt(null);
            const res = await apiCall<{ sdkConnections: number }>(
              "/organization/rebuild-sdk-payloads",
              { method: "POST" },
            );
            setRebuilt(res.sdkConnections);
          }}
        >
          Rebuild SDK payloads
        </Button>
      </Box>
    </SettingsGroup>
  );
}

export default function SDKConnectionSettings() {
  const { hasCommercialFeature } = useUser();
  const { watch, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();

  return (
    <>
      {hasCommercialFeature("require-project-for-sdk-connections-setting") && (
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
      {!isCloud() && <RebuildSDKPayloads />}
    </>
  );
}
