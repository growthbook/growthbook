import { FC, useMemo } from "react";
import { Environment } from "shared/types/organization";
import { FeatureEnvironment } from "shared/types/feature";
import { Box, Grid, Text } from "@radix-ui/themes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";

const EnvironmentCheckboxes: FC<{
  environmentSettings: Record<string, Pick<FeatureEnvironment, "enabled">>;
  environments: Environment[];
  setValue: (env: Environment, enabled: boolean) => void;
  project: string;
}> = ({ environmentSettings, environments, setValue, project }) => {
  const permissionsUtil = usePermissionsUtil();
  const environmentsUserCanAccess = useMemo(() => {
    return environments.filter((env) => {
      return permissionsUtil.canPublishFeature({ project }, [env.id]);
    });
  }, [environments, permissionsUtil, project]);

  const selectAllChecked = environmentsUserCanAccess.every(
    (env) => environmentSettings[env.id]?.enabled,
  );
  const selectAllIndeterminate = environmentsUserCanAccess.some(
    (env) => environmentSettings[env.id]?.enabled,
  );

  return (
    <Box className="box" p="4" style={{ borderRadius: "var(--radius-2)" }}>
      <div>
        <Checkbox
          value={
            selectAllChecked
              ? true
              : selectAllIndeterminate
                ? "indeterminate"
                : false
          }
          setValue={(v) =>
            environmentsUserCanAccess.forEach((env) => {
              setValue(env, v === true);
            })
          }
          label="Select All"
          weight="bold"
          mb="5"
        />
      </div>
      <Grid
        columns={{ initial: "2", md: "4" }}
        flow="row"
        style={{ maxHeight: "168px", wordBreak: "break-all" }}
        overflowY="auto"
      >
        {environments.map((env) => (
          <Checkbox
            disabled={!permissionsUtil.canPublishFeature({ project }, [env.id])}
            disabledMessage="You don't have permission to create features in this environment."
            value={environmentSettings[env.id].enabled}
            setValue={(enabled) => setValue(env, enabled === true)}
            label={env.id}
            key={env.id}
            weight="regular"
            mb="1"
            mr="2"
          />
        ))}
      </Grid>
    </Box>
  );
};

const EnvironmentSelect: FC<{
  environmentSettings: Record<string, Pick<FeatureEnvironment, "enabled">>;
  environments: Environment[];
  setValue: (env: Environment, enabled: boolean) => void;
  label?: string;
  project?: string;
  draftMode?: boolean;
  onDraftModeChange?: (isDraft: boolean) => void;
}> = ({
  environmentSettings,
  environments,
  setValue,
  label,
  project = "",
  draftMode,
  onDraftModeChange,
}) => {
  if (draftMode != null && onDraftModeChange) {
    return (
      <div className="form-group">
        <Text as="label" weight="bold" mb="1">
          {label || "Enabled Environments"}
        </Text>
        <RadioGroup
          value={draftMode ? "draft" : "environments"}
          setValue={(v) => onDraftModeChange(v === "draft")}
          mt="1"
          gap="1"
          options={[
            {
              value: "draft",
              label: <>Start in draft mode</>,
              description: (
                <>
                  <strong>OFF</strong> in all environments on start. You can use
                  a feature rollout to safely release this feature.
                </>
              ),
            },
            {
              value: "environments",
              label: (
                <>
                  Start <strong>ON</strong> in specific environments
                </>
              ),
              renderOnSelect: (
                <Box mt="0">
                  <EnvironmentCheckboxes
                    environmentSettings={environmentSettings}
                    environments={environments}
                    setValue={setValue}
                    project={project}
                  />
                </Box>
              ),
              renderOutsideItem: true,
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="form-group">
      <Text as="label" weight="bold" mb="1">
        {label || "Enabled Environments"}
      </Text>
      <Text as="p" size="1" color="gray" mb="2">
        Which environments are toggled <strong>ON</strong> by default in the new
        feature. Disabled environments will be excluded from the SDK Payload.
      </Text>
      <EnvironmentCheckboxes
        environmentSettings={environmentSettings}
        environments={environments}
        setValue={setValue}
        project={project}
      />
    </div>
  );
};

export default EnvironmentSelect;
