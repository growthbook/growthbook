import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { interleavingEnvsForChange } from "shared/permissions";
import { useRestApiCall } from "@/services/restApi";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import EnvironmentSelect from "@/components/Features/FeatureModal/EnvironmentSelect";

export default function EditInterleavingEnvironmentsModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const { t } = useLingui();
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const [envSettings, setEnvSettings] = useState(il.environmentSettings);

  const canEnableEnvironment = (environmentId: string) =>
    permissionsUtil.canRunInterleaving({ project: il.project }, [
      environmentId,
    ]);

  const servingEnvs = interleavingEnvsForChange({
    existing: il,
    environmentIds: environments.map((e) => e.id),
  });
  const canEditExistingEnvironments = permissionsUtil.canRunInterleaving(
    { project: il.project },
    servingEnvs,
  );

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-environments"
      header={t`Edit Environments`}
      close={close}
      cta={t`Save`}
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
          <Trans>
            You don&apos;t have permission to change every environment where
            this experiment is enabled.
          </Trans>
        </Callout>
      )}
      {il.status === "running" && (
        <Callout status="warning" mb="3">
          <Trans>
            This experiment is running. Saved changes apply to live traffic
            immediately.
          </Trans>
        </Callout>
      )}
      <EnvironmentSelect
        environmentSettings={envSettings}
        environments={environments}
        project={il.project}
        canEnableEnvironment={(envId) =>
          canEditExistingEnvironments && canEnableEnvironment(envId)
        }
        setValue={(env, enabled) =>
          setEnvSettings((prev) => ({
            ...prev,
            [env.id]: { ...prev[env.id], enabled },
          }))
        }
        isEditing
      />
    </ModalStandard>
  );
}
