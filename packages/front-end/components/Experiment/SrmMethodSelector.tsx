import React, { FC, useCallback, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Flex, Box } from "@radix-ui/themes";
import {
  DEFAULT_SRM_DIRICHLET_CONCENTRATION,
  DEFAULT_SRM_METHOD,
  DEFAULT_SRM_SLAB_WEIGHT,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
import useOrgSettings from "@/hooks/useOrgSettings";
import Checkbox from "@/ui/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";

const SrmMethodSelector: FC<{
  experimentSrmMethodDefined: boolean;
  onUseOrgDefaultChange: (useDefault: boolean) => void;
}> = ({ experimentSrmMethodDefined, onUseOrgDefaultChange }) => {
  const form = useFormContext();
  const orgSettings = useOrgSettings();

  const [usingOrgSrmMethod, setUsingOrgSrmMethod] = useState(
    !experimentSrmMethodDefined,
  );

  const setSrmMethodToDefault = useCallback(
    (enable: boolean) => {
      if (enable) {
        form.setValue("srmMethod", orgSettings.srmMethod ?? DEFAULT_SRM_METHOD);
        form.setValue(
          "srmThreshold",
          orgSettings.srmThreshold ?? DEFAULT_SRM_THRESHOLD,
        );
        form.setValue(
          "srmSlabWeight",
          orgSettings.srmSlabWeight ?? DEFAULT_SRM_SLAB_WEIGHT,
        );
        form.setValue(
          "srmDirichletConcentration",
          orgSettings.srmDirichletConcentration ??
            DEFAULT_SRM_DIRICHLET_CONCENTRATION,
        );
      }
      setUsingOrgSrmMethod(enable);
      onUseOrgDefaultChange(enable);
    },
    [
      form,
      orgSettings.srmMethod,
      orgSettings.srmThreshold,
      orgSettings.srmSlabWeight,
      orgSettings.srmDirichletConcentration,
      onUseOrgDefaultChange,
    ],
  );

  const srmMethod = form.watch("srmMethod") ?? DEFAULT_SRM_METHOD;

  return (
    <>
      <Flex gap="4" align="start">
        <Box style={{ flex: "0 0 40%" }}>
          <SelectField
            label="SRM Test Method"
            labelClassName="font-weight-bold"
            value={srmMethod}
            onChange={(v) => {
              form.setValue("srmMethod", v as "chi_squared" | "sequential");
            }}
            options={[
              { label: "Chi-squared", value: "chi_squared" },
              { label: "Sequential", value: "sequential" },
            ]}
            helpText="Chi-squared is the default. Sequential (SSRM) is better suited for experiments monitored continuously."
            disabled={usingOrgSrmMethod}
          />
        </Box>
        <Box pt="5">
          <label>
            <Checkbox
              value={usingOrgSrmMethod}
              setValue={(v) => setSrmMethodToDefault(v)}
            />{" "}
            Reset to Organization Default
          </label>
        </Box>
      </Flex>
      <Flex gap="4">
        <Box style={{ flex: 1 }}>
          <Field
            label="P-value Threshold"
            helpText="P-value below which SRM is flagged. Default is 0.001."
            type="number"
            step="0.001"
            min={0}
            max={1}
            disabled={usingOrgSrmMethod}
            {...form.register("srmThreshold", {
              valueAsNumber: true,
              min: 0,
              max: 1,
            })}
          />
        </Box>
        {srmMethod === "sequential" && (
          <>
            <Box style={{ flex: 1 }}>
              <Field
                label="Concentration"
                helpText="Dirichlet concentration for the informative prior."
                type="number"
                step={1}
                min={1}
                disabled={usingOrgSrmMethod}
                {...form.register("srmDirichletConcentration", {
                  valueAsNumber: true,
                  min: 1,
                })}
              />
            </Box>
            <Box style={{ flex: 1 }}>
              <Field
                label="Slab Weight"
                helpText="Mixture weight for the diffuse prior. 0 = spike only."
                type="number"
                step="0.01"
                min={0}
                max={1}
                disabled={usingOrgSrmMethod}
                {...form.register("srmSlabWeight", {
                  valueAsNumber: true,
                  min: 0,
                  max: 1,
                })}
              />
            </Box>
          </>
        )}
      </Flex>
    </>
  );
};

export default SrmMethodSelector;
