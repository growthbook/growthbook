import { FC, useMemo, useState } from "react";
import { Environment } from "shared/types/organization";
import { FeatureEnvironment } from "shared/types/feature";
import { Box, Flex, Grid, Text } from "@radix-ui/themes";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import { featureStatusColors } from "@/components/Features/FeaturesOverview";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import UIText from "@/ui/Text";

const MAX_VISIBLE_PREVIEW_ENVIRONMENTS = 3;

function envPreviewItem(envId: string, enabled: boolean) {
  return (
    <Flex key={envId} align="center" gap="1">
      {enabled ? (
        <FaCircleCheck size={14} style={{ color: featureStatusColors.on }} />
      ) : (
        <FaCircleXmark
          size={14}
          style={{ color: featureStatusColors.offMuted }}
        />
      )}
      <UIText size="small">{envId}</UIText>
    </Flex>
  );
}

const EnvironmentSelect: FC<{
  environmentSettings: Record<string, Pick<FeatureEnvironment, "enabled">>;
  environments: Environment[];
  setValue: (env: Environment, enabled: boolean) => void;
  project?: string;
  isEditing?: boolean;
}> = ({
  environmentSettings,
  environments,
  setValue,
  project = "",
  isEditing = false,
}) => {
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

  const [expanded, setExpanded] = useState(isEditing);

  const visible = environments.slice(0, MAX_VISIBLE_PREVIEW_ENVIRONMENTS);
  const overflow = environments.slice(MAX_VISIBLE_PREVIEW_ENVIRONMENTS);

  return (
    <div className="form-group">
      <Flex align="center" justify="between" mb="1" gap="3">
        <Text as="label" weight="bold" mb="0">
          Include in SDK Payloads
        </Text>
        {!expanded && <Link onClick={() => setExpanded(true)}>Edit</Link>}
      </Flex>

      {!isEditing && (
        <Text as="p" size="1" color="gray" mb="3">
          Initial state only, can be changed later.
        </Text>
      )}

      {!expanded ? (
        <Flex gap="3" wrap="wrap" align="center">
          {visible.map((env) =>
            envPreviewItem(env.id, !!environmentSettings[env.id]?.enabled),
          )}
          {overflow.length > 0 && (
            <Tooltip
              flipTheme={false}
              body={
                <Flex direction="column" gap="1">
                  {overflow.map((env) =>
                    envPreviewItem(
                      env.id,
                      !!environmentSettings[env.id]?.enabled,
                    ),
                  )}
                </Flex>
              }
            >
              <UIText as="span" color="text-low" size="small">
                +{overflow.length} more
              </UIText>
            </Tooltip>
          )}
        </Flex>
      ) : (
        <Box
          className="box"
          p="4"
          style={{
            borderRadius: "var(--radius-2)",
          }}
        >
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
                disabled={
                  !permissionsUtil.canPublishFeature({ project }, [env.id])
                }
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
      )}
    </div>
  );
};

export default EnvironmentSelect;
