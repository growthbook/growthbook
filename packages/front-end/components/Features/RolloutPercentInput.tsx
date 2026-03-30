import { Slider, Flex, Box } from "@radix-ui/themes";
import { ReactNode, useState } from "react";
import { PiCaretRightFill, PiCaretDownFill } from "react-icons/pi";
import { SDKAttributeSchema } from "shared/types/organization";
import Collapsible from "react-collapsible";
import styles from "@/components/Features/VariationsInput.module.scss";
import Field from "@/components/Forms/Field";
import { decimalToPercent, percentToDecimal } from "@/services/utils";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/ui/DropdownMenu";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";

export interface Props {
  value: number;
  setValue: (value: number) => void;
  label?: string;
  labelActions?: ReactNode;
  locked?: boolean;
  lockedByRamp?: boolean;
  // Hash attribute selection
  hashAttribute?: string;
  setHashAttribute?: (v: string) => void;
  attributeSchema?: SDKAttributeSchema;
  hasHashAttributes?: boolean;
  // Advanced options
  seed?: string;
  setSeed?: (v: string) => void;
  featureId?: string;
  advancedOpen?: boolean;
  setAdvancedOpen?: (v: boolean) => void;
}

export default function RolloutPercentInput({
  value,
  setValue,
  label = "Rollout Percentage",
  labelActions,
  locked,
  lockedByRamp,
  hashAttribute,
  setHashAttribute,
  attributeSchema,
  hasHashAttributes,
  seed,
  setSeed,
  featureId,
  advancedOpen,
  setAdvancedOpen,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const filteredAttributes = attributeSchema?.filter(
    (s) => !hasHashAttributes || s.hashAttribute,
  );

  const currentAttributeName =
    hashAttribute ||
    filteredAttributes?.find((s) => s.property === hashAttribute)?.property ||
    "user id";

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
      {lockedByRamp ? (
        <Text as="div" fontStyle="italic" color="text-mid" mt="2" mb="3">
          Controlled by ramp-up schedule
        </Text>
      ) : (
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
      )}

      {(setHashAttribute && attributeSchema) ||
      (setSeed && setAdvancedOpen !== undefined) ? (
        <Box pl="5">
          {setHashAttribute && attributeSchema && (
            <Flex align="center" gap="2" mb={setSeed ? "2" : "0"}>
              <Text weight="medium">Sample using attribute</Text>
              <DropdownMenu
                trigger={
                  <Link
                    type="button"
                    style={{ color: "var(--color-text-high)" }}
                  >
                    <Text mr="1">{currentAttributeName}</Text>
                    <PiCaretDownFill style={{ fontSize: "12px" }} />
                  </Link>
                }
                open={dropdownOpen}
                onOpenChange={setDropdownOpen}
                menuPlacement="start"
                variant="soft"
              >
                <DropdownMenuGroup>
                  {filteredAttributes?.map((attr) => (
                    <DropdownMenuItem
                      key={attr.property}
                      onClick={() => {
                        setHashAttribute(attr.property);
                        setDropdownOpen(false);
                      }}
                    >
                      <AttributeOptionWithTooltip
                        option={
                          {
                            label: attr.property,
                            value: attr.property,
                            description: attr.description,
                            tags: attr.tags,
                            datatype: attr.datatype,
                            hashAttribute: attr.hashAttribute,
                          } as AttributeOptionForTooltip
                        }
                        context="menu"
                      >
                        {attr.property}
                      </AttributeOptionWithTooltip>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenu>
            </Flex>
          )}

          {setSeed && setAdvancedOpen !== undefined && (
            <Collapsible
              trigger={
                <span className="cursor-pointer">
                  <PiCaretRightFill className="chevron" /> Change seed
                </span>
              }
              open={advancedOpen}
              onTriggerOpening={() => setAdvancedOpen(true)}
              onTriggerClosing={() => setAdvancedOpen(false)}
              transitionTime={100}
            >
              <Box mt="2">
                <Field
                  type="input"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder={featureId}
                  helpText={
                    <HelperText status="warning" size="sm">
                      Changing this will re-randomize rollout traffic.
                    </HelperText>
                  }
                />
              </Box>
            </Collapsible>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
