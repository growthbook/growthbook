import { Slider, Flex, Box } from "@radix-ui/themes";
import { ReactNode, useEffect } from "react";
import { PiCaretRight } from "react-icons/pi";
import { SDKAttributeSchema } from "shared/types/organization";
import { RampScheduleInterface } from "shared/validators";
import Collapsible from "react-collapsible";
import styles from "@/components/Features/VariationsInput.module.scss";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import Text from "@/ui/Text";
import { allConnectionsSupportBucketingV2 } from "@/components/Experiment/HashVersionSelector";
import useSDKConnections from "@/hooks/useSDKConnections";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";

export interface RolloutHashingOptionsProps {
  // Collapsible open state
  open: boolean;
  setOpen: (v: boolean) => void;
  // Seed
  seed: string;
  setSeed: (v: string) => void;
  ruleId?: string;
  featureId?: string;
  /** Show a warning that changing the seed re-randomizes traffic */
  isLive?: boolean;
  // Hash attribute selection (optional)
  hashAttribute?: string;
  setHashAttribute?: (v: string) => void;
  attributeSchema?: SDKAttributeSchema;
  hasHashAttributes?: boolean;
  // Hash version (optional)
  hashVersion?: 1 | 2;
  setHashVersion?: (v: 1 | 2) => void;
  project?: string;
}

export function RolloutHashingOptions({
  open,
  setOpen,
  seed,
  setSeed,
  ruleId,
  featureId,
  isLive,
  hashAttribute,
  setHashAttribute,
  attributeSchema,
  hasHashAttributes,
  hashVersion,
  setHashVersion,
  project,
}: RolloutHashingOptionsProps) {
  const filteredAttributes = attributeSchema?.filter(
    (s) => !hasHashAttributes || s.hashAttribute,
  );

  const { data: sdkConnectionsData } = useSDKConnections();
  // Fallback for call sites that don't wire hashVersion through a form
  // (e.g. RampScheduleModal, RampScheduleTemplates). In the rule modal the
  // form always has hashVersion pre-seeded, so this path is rarely hit.
  const effectiveHashVersion =
    hashVersion ??
    (allConnectionsSupportBucketingV2(sdkConnectionsData?.connections, project)
      ? 2
      : 1);

  useEffect(() => {
    if (hashVersion === undefined && setHashVersion) {
      setHashVersion(effectiveHashVersion);
    }
  }, [effectiveHashVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {setHashAttribute && filteredAttributes && (
        <Flex gap="3" align="center" mb="1">
          <Box style={{ width: 70 }}>
            <Text as="label" weight="medium" mb="0">
              Sample by
            </Text>
          </Box>
          <SelectField
            value={hashAttribute ?? ""}
            onChange={(v) => setHashAttribute(v)}
            options={filteredAttributes.map(
              (a): AttributeOptionForTooltip => ({
                value: a.property,
                label: a.property,
                description: a.description,
                tags: a.tags,
                datatype: a.datatype,
                hashAttribute: a.hashAttribute,
              }),
            )}
            formatOptionLabel={(o, meta) => (
              <AttributeOptionWithTooltip
                option={o as AttributeOptionForTooltip}
                context={meta.context}
              >
                {o.label}
              </AttributeOptionWithTooltip>
            )}
            containerStyle={{ minHeight: 38, width: 150 }}
          />
        </Flex>
      )}
      <Collapsible
        trigger={
          <div
            className="link-purple"
            style={{ marginTop: 4, display: "inline-block" }}
          >
            <PiCaretRight className="chevron mr-1" />
            Hashing &amp; seed options
          </div>
        }
        open={open}
        onTriggerOpening={() => setOpen(true)}
        onTriggerClosing={() => setOpen(false)}
        transitionTime={100}
      >
        <Box px="4" pt="2" pb="1" mt="2" className="bg-highlight rounded">
          <Flex direction="column" gap="1">
            <Field
              label="Seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder={ruleId ?? featureId}
              helpText={
                isLive
                  ? "Changing this re-randomizes rollout traffic."
                  : undefined
              }
            />
            {setHashVersion && (
              <>
                <SelectField
                  label="Hashing"
                  value={String(effectiveHashVersion)}
                  onChange={(v) => setHashVersion?.(Number(v) as 1 | 2)}
                  options={[
                    { value: "2", label: "V2 (Preferred)" },
                    { value: "1", label: "V1 (Legacy)" },
                  ]}
                />
                {effectiveHashVersion === 2 && (
                  <SDKCapabilityWarning
                    as="helperText"
                    capability="bucketingV2"
                    project={project}
                    someMessage="Some of your SDK Connections may not support V2 hashing."
                    noneMessage="None of your SDK Connections support V2 hashing."
                  />
                )}
              </>
            )}
          </Flex>
        </Box>
      </Collapsible>
    </>
  );
}

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
  ruleId?: string;
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
  ruleId,
  featureId,
  advancedOpen,
  setAdvancedOpen,
  isLiveRule,
  isNew,
  rampSchedule,
}: Props) {
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
            size="legacy"
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

      {showAdvancedSection && setSeed && setAdvancedOpen !== undefined && (
        <RolloutHashingOptions
          open={advancedOpen ?? false}
          setOpen={setAdvancedOpen}
          seed={seed ?? ""}
          setSeed={setSeed}
          ruleId={ruleId}
          featureId={featureId}
          isLive={isLiveRule}
          hashAttribute={hashAttribute}
          setHashAttribute={setHashAttribute}
          attributeSchema={attributeSchema}
          hasHashAttributes={hasHashAttributes}
          hashVersion={hashVersion}
          setHashVersion={setHashVersion}
          project={project}
        />
      )}
    </Box>
  );
}
