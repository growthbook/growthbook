import { Slider, Flex, Box } from "@radix-ui/themes";
import { ReactNode, useEffect } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { SDKAttributeSchema } from "shared/types/organization";
import { RampScheduleInterface } from "shared/validators";
import Collapsible from "react-collapsible";
import styles from "@/components/Features/VariationsInput.module.scss";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import useSDKConnections from "@/hooks/useSDKConnections";

export interface Props {
  value: number;
  setValue: (value: number) => void;
  label?: string;
  labelActions?: ReactNode;
  locked?: boolean;
  // Hash attribute selection
  hashAttribute?: string;
  setHashAttribute?: (v: string) => void;
  attributeSchema?: SDKAttributeSchema;
  hasHashAttributes?: boolean;
  // Hash version
  hashVersion?: 1 | 2;
  setHashVersion?: (v: 1 | 2) => void;
  project?: string;
  // Advanced options
  seed?: string;
  setSeed?: (v: string) => void;
  featureId?: string;
  advancedOpen?: boolean;
  setAdvancedOpen?: (v: boolean) => void;
  existingRule?: boolean;
  /** When provided, the advanced section is also shown if any ramp step or end action has coverage < 100%. */
  rampSchedule?: RampScheduleInterface;
}

export default function RolloutPercentInput({
  value,
  setValue,
  label = "Rollout Percentage",
  labelActions,
  locked,
  hashAttribute,
  setHashAttribute,
  attributeSchema,
  hasHashAttributes,
  hashVersion,
  setHashVersion,
  project,
  seed,
  setSeed,
  featureId,
  advancedOpen,
  setAdvancedOpen,
  existingRule,
  rampSchedule,
}: Props) {
  const filteredAttributes = attributeSchema?.filter(
    (s) => !hasHashAttributes || s.hashAttribute,
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  const hashVersionSdkWarning =
    hashVersion === 2 &&
    !allConnectionsSupportBucketingV2(sdkConnectionsData?.connections, project);

  useEffect(() => {
    if (!setAdvancedOpen) return;
    if (seed || hashVersion === 1 || hashVersionSdkWarning) {
      setAdvancedOpen(true);
    }
  }, [seed, hashVersion, hashVersionSdkWarning]); // eslint-disable-line react-hooks/exhaustive-deps

  const rampHasSubMaxCoverage =
    rampSchedule != null &&
    [
      ...rampSchedule.steps.flatMap((s) => s.actions),
      ...(rampSchedule.endActions ?? []),
    ].some(
      (a) =>
        a.targetType === "feature-rule" &&
        a.patch.coverage !== undefined &&
        (a.patch.coverage ?? 1) < 1,
    );

  const showAdvancedSection = value < 1 || rampHasSubMaxCoverage;

  return (
    <Box>
      {(label || labelActions) && (
        <Flex justify="between" align="center" mb="2">
          <Text as="div" size="medium" weight="semibold">
            {label}
          </Text>
          {labelActions}
        </Flex>
      )}
      <Flex align="center" gap="3" mb="1">
        <Box flexGrow="1">
          <Slider
            value={[value]}
            min={0}
            max={1}
            step={0.01}
            disabled={locked}
            onValueChange={(e) => {
              setValue(e[0]);
            }}
          />
        </Box>
        <Box position="relative" className={styles.percentInputWrap}>
          <Field
            style={{ width: 95 }}
            disabled={locked}
            value={isNaN(value ?? 0) ? "" : decimalToPercent(value ?? 0)}
            step={1}
            onChange={(e) => {
              let decimal = percentToDecimal(e.target.value);
              if (decimal > 1) decimal = 1;
              if (decimal < 0) decimal = 0;
              setValue(decimal);
            }}
            type="number"
          />
          <span>%</span>
        </Box>
      </Flex>

      {showAdvancedSection ? (
        <Box px="4" py="2" mt="2" className="bg-highlight rounded">
          {setHashAttribute && attributeSchema && (
            <SelectField
              label="Sample using attribute"
              value={hashAttribute ?? ""}
              options={
                filteredAttributes?.map((attr) => ({
                  label: attr.property,
                  value: attr.property,
                })) ?? []
              }
              onChange={(v) => setHashAttribute(v)}
              containerClassName="mb-1"
            />
          )}

          {setSeed && setAdvancedOpen !== undefined && (
            <Collapsible
              trigger={
                <div className="link-purple" style={{ marginTop: 4 }}>
                  <PiCaretRightFill className="chevron mr-1" />
                  Hashing &amp; seed options
                </div>
              }
              open={advancedOpen}
              onTriggerOpening={() => setAdvancedOpen(true)}
              onTriggerClosing={() => setAdvancedOpen(false)}
              transitionTime={100}
            >
              <Box mt="1">
                <Field
                  label="Seed"
                  type="input"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder={featureId}
                  helpText={
                    existingRule ? (
                      <HelperText status="warning" size="sm">
                        Changing this will re-randomize rollout traffic.
                      </HelperText>
                    ) : undefined
                  }
                />
                {setHashVersion && (
                  <>
                    <Flex align="center" gap="1" mt="1">
                      <Text as="label" weight="medium" mb="0">
                        Hashing:
                      </Text>
                      <select
                        className="form-control form-control-sm d-inline-block w-auto"
                        value={hashVersion ?? 1}
                        onChange={(e) =>
                          setHashVersion(Number(e.target.value) as 1 | 2)
                        }
                        style={{ fontSize: 13 }}
                      >
                        <option value={2}>V2 (Preferred)</option>
                        <option value={1}>V1 (Legacy)</option>
                      </select>
                    </Flex>
                    {hashVersionSdkWarning && (
                      <HelperText status="warning" size="sm" mt="1">
                        Some SDK connections may not support V2 hashing.
                        Unsupported SDKs will fall back to V1 automatically.
                      </HelperText>
                    )}
                  </>
                )}
              </Box>
            </Collapsible>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
