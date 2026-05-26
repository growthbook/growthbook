import { Slider, Flex, Box } from "@radix-ui/themes";
import { ReactNode, useEffect } from "react";
import { PiCaretRightFill, PiCaretDownFill } from "react-icons/pi";
import { SDKAttributeSchema } from "shared/types/organization";
import { RampScheduleInterface } from "shared/validators";
import Collapsible from "react-collapsible";
import styles from "@/components/Features/VariationsInput.module.scss";
import Field from "@/components/Forms/Field";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import useSDKConnections from "@/hooks/useSDKConnections";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";

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
  isLiveRule?: boolean;
  isNew?: boolean;
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
  isLiveRule,
  isNew,
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
    // For new rules, v1 is the org-safe default — don't expand just because it
    // was auto-selected. Only expand when the user has actively customised the
    // seed, when there's an SDK compatibility warning, or when editing an
    // existing rule that already uses v1 (so they're aware of the legacy choice).
    if (seed || hashVersionSdkWarning || (!isNew && hashVersion === 1)) {
      setAdvancedOpen(true);
    }
  }, [seed, hashVersion, hashVersionSdkWarning]); // eslint-disable-line react-hooks/exhaustive-deps

  const rampHasSubMaxCoverage =
    !!rampSchedule &&
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
            <Flex align="center" gap="1" mb="1">
              <Text as="label" weight="medium" mb="0">
                Sample users by:
              </Text>
              <DropdownMenu
                trigger={
                  <Link
                    type="button"
                    style={{ color: "var(--color-text-high)" }}
                  >
                    <Text mr="1">{hashAttribute || "—"}</Text>
                    <PiCaretDownFill />
                  </Link>
                }
                menuPlacement="start"
                variant="soft"
              >
                <DropdownMenuGroup>
                  {(filteredAttributes ?? []).map((attr) => (
                    <DropdownMenuItem
                      key={attr.property}
                      onClick={() => setHashAttribute(attr.property)}
                    >
                      {attr.property}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>
          )}

          {setSeed && setAdvancedOpen !== undefined && (
            <Collapsible
              trigger={
                <div
                  className="link-purple"
                  style={{ marginTop: 4, display: "inline-block" }}
                >
                  <PiCaretRightFill className="chevron mr-1" />
                  Hashing &amp; seed options
                </div>
              }
              open={advancedOpen}
              onTriggerOpening={() => setAdvancedOpen(true)}
              onTriggerClosing={() => setAdvancedOpen(false)}
              transitionTime={100}
            >
              <>
                <Flex align="center" gap="3" py="1" style={{ minHeight: 42 }}>
                  <Box style={{ width: 70 }}>
                    <Text as="label" weight="medium" ml="2" mb="0">
                      Seed
                    </Text>
                  </Box>
                  <Box style={{ width: 150 }}>
                    <Field
                      type="input"
                      value={seed ?? ""}
                      onChange={(e) => setSeed(e.target.value)}
                      placeholder={featureId}
                      containerClassName="mb-0"
                    />
                  </Box>
                </Flex>
                {isLiveRule && (
                  <HelperText status="warning" size="sm" mb="0">
                    Changing this re-randomizes rollout traffic.
                  </HelperText>
                )}
                {setHashVersion && (
                  <>
                    <Flex
                      align="center"
                      gap="3"
                      py="1"
                      style={{ minHeight: 42 }}
                    >
                      <Box style={{ width: 70 }}>
                        <Text as="label" weight="medium" ml="2" mb="0">
                          Hashing
                        </Text>
                      </Box>
                      <Box>
                        <DropdownMenu
                          trigger={
                            <Link
                              type="button"
                              style={{ color: "var(--color-text-high)" }}
                            >
                              <Text mr="1">
                                {hashVersion === 2
                                  ? "V2 (Preferred)"
                                  : "V1 (Legacy)"}
                              </Text>
                              <PiCaretDownFill />
                            </Link>
                          }
                          menuPlacement="start"
                          variant="soft"
                        >
                          <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => setHashVersion(2)}>
                              V2 (Preferred)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setHashVersion(1)}>
                              V1 (Legacy)
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenu>
                      </Box>
                    </Flex>
                    {hashVersion === 2 && (
                      <SDKCapabilityWarning
                        as="helperText"
                        capability="bucketingV2"
                        project={project}
                        someMessage="Some of your SDK Connections may not support V2 hashing."
                        noneMessage="None of your SDK Connections support V2 hashing."
                        mb="0"
                        mt="1"
                      />
                    )}
                  </>
                )}
              </>
            </Collapsible>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
