import { FeatureInterface } from "shared/types/feature";
import { filterEnvironmentsByFeature } from "shared/util";
import { Flex, useThemeContext, Text } from "@radix-ui/themes";
import DiffViewerClient, {
  DiffMethod,
} from "@/components/DiffViewer/DiffViewerClient";
import { getRules, useEnvironments } from "@/services/features";
import Modal from "@/components/Modal";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import EnvironmentDropdown from "@/components/Environments/EnvironmentDropdown";
import Badge from "@/ui/Badge";

export interface Props {
  feature: FeatureInterface;
  sourceEnv?: string;
  setSourceEnv: (env: string) => void;
  targetEnv?: string;
  setTargetEnv: (env: string) => void;
  version: number;
  setVersion: (version: number) => void;
  setEnvironment: (env: string) => void;
  cancel: () => void;
  mutate: () => Promise<unknown>;
}

export default function CompareEnvironmentsModal({
  feature,
  sourceEnv,
  setSourceEnv,
  targetEnv,
  setTargetEnv,
  version,
  setVersion,
  setEnvironment,
  cancel,
  mutate,
}: Props) {
  const { apiCall } = useAuth();
  const { appearance } = useThemeContext();

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);
  const rulesByEnv = Object.fromEntries(
    environments.map((e) => {
      const rules = getRules(feature, e.id);
      return [e.id, rules];
    }),
  );

  const submit = async () => {
    if (!sourceEnv || !targetEnv) return;
    const res = await apiCall<{ version: number }>(
      `/feature/${feature.id}/${version}/copyEnvironment`,
      {
        method: "POST",
        body: JSON.stringify({
          sourceEnv,
          targetEnv,
        }),
      },
    );
    track("Copy Feature Rules", {
      sourceEnv,
      targetEnv,
    });
    await mutate();
    setVersion(res.version);
    setEnvironment(targetEnv);
  };

  return (
    <Modal
      trackingEventModalType="compare-environments"
      header="Copy Rules Across Environments"
      open={true}
      close={cancel}
      submit={submit}
      cta="Overwrite Target Rules"
      ctaEnabled={!!sourceEnv && !!targetEnv}
      size="lg"
    >
      <div>
        Rules from source environment will <strong>overwrite</strong> any
        existing rules on target environment for this Feature Rules Draft
        revision.
      </div>
      <EnvironmentDropdown
        label="Select Source Environment"
        env={sourceEnv}
        setEnv={setSourceEnv}
        environments={environments}
        formatOptionLabel={({ value }) => (
          <Flex justify="between" align="center">
            <Flex maxWidth="calc(100% - 130px)">
              <Text truncate>{value}</Text>
            </Flex>
            <Badge
              label={`${rulesByEnv[value].length} Rule${
                rulesByEnv[value].length === 1 ? "" : "s"
              } applied`}
              ml="2"
            />
          </Flex>
        )}
      />
      <EnvironmentDropdown
        label="Select Target Environment"
        env={targetEnv}
        setEnv={setTargetEnv}
        environments={environments.filter((env) => env.id !== sourceEnv)}
        formatOptionLabel={({ value }) => (
          <Flex justify="between" align="center">
            <Flex maxWidth="calc(100% - 130px)">
              <Text truncate>{value}</Text>
            </Flex>
            <Badge
              label={`${rulesByEnv[value].length} Rule${
                rulesByEnv[value].length === 1 ? "" : "s"
              } applied`}
              ml="2"
            />
          </Flex>
        )}
      />

      {sourceEnv && targetEnv && sourceEnv !== targetEnv && (
        <DiffViewerClient
          oldValue={JSON.stringify(rulesByEnv[targetEnv], null, 2)}
          newValue={JSON.stringify(rulesByEnv[sourceEnv], null, 2)}
          compareMethod={DiffMethod.LINES}
          useDarkTheme={appearance === "dark"}
          styles={{
            contentText: {
              wordBreak: "break-all",
            },
          }}
        />
      )}
    </Modal>
  );
}
