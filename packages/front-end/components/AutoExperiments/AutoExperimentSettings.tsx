import { useState } from "react";
import {
  AUTO_EXPERIMENT_FEATURES,
  getAutoExperimentParentFeature,
} from "shared/util";
import type { AutoExperimentFeature } from "shared/types/organization";
import { Box } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import useAutoExperiments from "@/hooks/useAutoExperiments";
import EnableAutoExperimentDialog, {
  AUTO_EXPERIMENT_COPY,
} from "./EnableAutoExperimentDialog";

// Saved on their own, not with the settings form: each change is confirmed.
export default function AutoExperimentSettings() {
  const { isEnabled, setEnabled, canManage } = useAutoExperiments();
  const [enabling, setEnabling] = useState<AutoExperimentFeature | null>(null);
  const [disabling, setDisabling] = useState<AutoExperimentFeature | null>(
    null,
  );

  return (
    <>
      {AUTO_EXPERIMENT_FEATURES.map((feature) => {
        const parent = getAutoExperimentParentFeature(feature);
        if (parent && !isEnabled(parent)) return null;
        return (
          <Box key={feature} pl={parent ? "5" : "0"}>
            <Checkbox
              id={`toggle-autoExperiments-${feature}`}
              label={AUTO_EXPERIMENT_COPY[feature].name}
              disabled={!canManage}
              disabledMessage="Only admins can change this setting"
              value={isEnabled(feature)}
              setValue={(v) => (v ? setEnabling : setDisabling)(feature)}
            />
          </Box>
        );
      })}
      {enabling ? (
        <EnableAutoExperimentDialog
          feature={enabling}
          close={() => setEnabling(null)}
        />
      ) : null}
      {disabling ? (
        <ConfirmDialog
          title={`Disable ${AUTO_EXPERIMENT_COPY[disabling].blocked}?`}
          content="Running experiments that use this stop being sent to SDKs."
          yesText="Disable"
          color="red"
          onConfirm={async () => {
            await setEnabled(disabling, false);
            setDisabling(null);
          }}
          onCancel={() => setDisabling(null)}
        />
      ) : null}
    </>
  );
}
