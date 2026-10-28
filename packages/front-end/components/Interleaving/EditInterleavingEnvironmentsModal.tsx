import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Switch from "@/ui/Switch";

export default function EditInterleavingEnvironmentsModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const [envSettings, setEnvSettings] = useState(il.environmentSettings);
  const canEnableEnvironment = (environmentId: string) =>
    permissionsUtil.canRunInterleaving({ project: il.project }, [
      environmentId,
    ]);
  const enabledEnvironments = environments
    .filter((environment) => il.environmentSettings[environment.id]?.enabled)
    .map((environment) => environment.id);
  const canEditExistingEnvironments =
    enabledEnvironments.length === 0 ||
    permissionsUtil.canRunInterleaving(
      { project: il.project },
      enabledEnvironments,
    );

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-environments"
      header="Edit Environments"
      close={close}
      cta="Save"
      ctaEnabled={canEditExistingEnvironments}
      size="lg"
      submit={async () => {
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: { environmentSettings: envSettings },
        });
        await mutate();
      }}
    >
      {!canEditExistingEnvironments && (
        <Callout status="warning" mb="3">
          You don&apos;t have permission to change every environment where this
          experiment is enabled.
        </Callout>
      )}
      {il.status === "running" && (
        <Callout status="warning" mb="3">
          This experiment is running. Saved changes apply to live traffic
          immediately.
        </Callout>
      )}
      <Flex direction="column" gap="2">
        {environments.map((env) => {
          const canEnable =
            canEditExistingEnvironments && canEnableEnvironment(env.id);
          return (
            <Switch
              key={env.id}
              id={`il-env-${env.id}`}
              label={env.id}
              description={
                canEnable
                  ? undefined
                  : "You don't have permission to run experiments in this environment."
              }
              value={!!envSettings[env.id]?.enabled}
              disabled={!canEnable}
              onChange={(enabled) =>
                setEnvSettings({
                  ...envSettings,
                  [env.id]: { ...envSettings[env.id], enabled },
                })
              }
            />
          );
        })}
      </Flex>
    </ModalStandard>
  );
}
