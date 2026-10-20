import { useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import RadioCards from "@/ui/RadioCards";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import ConfirmRulesField, {
  SUGGESTED_CONFIRM_RULES,
} from "./ConfirmRulesField";
import { ALL, presetOf } from "./confirmRulesUtils";
import {
  Holder,
  isUnlimited,
  PermissionsValue,
  Preset,
  presetsFor,
  presetValue,
  startCustomizing,
} from "./apiKeyPermissions";

const PRESET_HELP = {
  recommended: (
    <Flex as="span" direction="column" gap="2">
      <span>
        Waits for confirmation before publishing, archiving or deleting,
        changing live experiments or ramps, skipping checks, or editing
        settings, access, environments, SDK Connections, metrics and the like.
      </span>
      <span>
        Creating things, working on drafts, AI Visual Editor changes, and writes
        like dashboards and comments run without confirmation.
      </span>
    </Flex>
  ),
  all: "Waits for confirmation before every write, including creating things and drafts. Only reads and calculations run without confirmation.",
};

// Who can confirm a held request (see canDecide in confirmationDecisions).
const CONFIRMER: Record<Holder, string> = {
  pat: "you",
  user: "the requesting user",
  system: "any member",
};

// What a restricted role does for a key that acts as a person: it only takes
// away, so what's allowed is what both the person and the rules allow.
const OVERLAP: Record<Exclude<Holder, "system">, string> = {
  pat: "This token can only do something if you can do it and the rules below allow it. The rules never add access you don't have.",
  user: "A request can only do something if the requesting member can do it and the rules below allow it. The rules never add access the member doesn't have.",
};

const FULL_ACCESS: Record<Holder, string> = {
  pat: "Everything you can do.",
  user: "Everything the requesting user can do.",
  system: "Full admin access.",
};

export default function PermissionsField({
  holder,
  value,
  setValue,
  canLimitRole,
}: {
  holder: Holder;
  value: PermissionsValue;
  setValue: (value: PermissionsValue) => void;
  // A plan with only the admin role has nothing to narrow a key to.
  canLimitRole: boolean;
}) {
  const descriptions: Record<Preset, string> = {
    readonly: "Can read, but every write is blocked.",
    hitl: `Risky or destructive actions wait for ${CONFIRMER[holder]} to confirm.`,
    full: FULL_ACCESS[holder],
  };
  const labels: Record<Preset, string> = {
    readonly: "Read only",
    hitl: "Human-in-the-Loop",
    full: "Full access",
  };

  return (
    <Box>
      <Flex justify="between" align="center" mb="2">
        <Text as="div" size="md" weight="semibold">
          Permissions
        </Text>
        <Link
          weight="medium"
          onClick={() =>
            setValue(
              value.customizing
                ? { ...value, customizing: false }
                : startCustomizing(value),
            )
          }
        >
          {value.customizing ? "Use a preset" : "Customize"}
        </Link>
      </Flex>
      {!value.customizing ? (
        <RadioCards
          width="100%"
          labelSize="md"
          descriptionSize="sm"
          truncateDescription={false}
          value={value.preset ?? ""}
          setValue={(preset) =>
            setValue({ ...value, preset: preset as Preset })
          }
          options={presetsFor(holder).map((preset) => ({
            value: preset,
            label: labels[preset],
            description: descriptions[preset],
            ...(preset === "readonly" &&
              !canLimitRole && {
                disabled: true,
                tooltip: "Your plan only supports the admin role.",
              }),
          }))}
        />
      ) : (
        <CustomPermissions
          holder={holder}
          value={value}
          setValue={setValue}
          canLimitRole={canLimitRole}
        />
      )}
    </Box>
  );
}

// Mounted each time Customize opens, so its toggles start from the preset it replaced.
function CustomPermissions({
  holder,
  value,
  setValue,
  canLimitRole,
}: {
  holder: Holder;
  value: PermissionsValue;
  setValue: (value: PermissionsValue) => void;
  canLimitRole: boolean;
}) {
  // A token or User key acts as a person, so its role is optional and only
  // narrows them. A System key's role is everything it can do.
  const actsAsPerson = holder !== "system";
  const [restricted, setRestricted] = useState(() => !isUnlimited(value.scope));
  // Unchecking and checking again brings back the rules that were set.
  const restrictedScope = useRef(
    isUnlimited(value.scope) ? presetValue("readonly").scope : value.scope,
  );
  // The rules editor stays tucked away unless the rules go beyond a preset.
  const [editingRules, setEditingRules] = useState(
    () => value.requireConfirmation && !presetOf(value.rules),
  );
  const allActions = presetOf(value.rules) === ALL;
  const roleTable = (
    <RoleRulesTable
      value={value.scope}
      setValue={(scope) => setValue({ ...value, scope })}
    />
  );

  return (
    <Flex direction="column" gap="5">
      {canLimitRole && !actsAsPerson && roleTable}
      {canLimitRole && actsAsPerson && (
        <Box>
          <Checkbox
            label="Restrict permissions"
            value={restricted}
            setValue={(on) => {
              setRestricted(on);
              if (on) {
                setValue({ ...value, scope: restrictedScope.current });
              } else {
                restrictedScope.current = value.scope;
                setValue({ ...value, scope: presetValue("full").scope });
              }
            }}
          />
          {restricted && (
            <Flex direction="column" gap="3" mt="3" pl="5">
              <Callout status="info">{OVERLAP[holder]}</Callout>
              {roleTable}
            </Flex>
          )}
        </Box>
      )}
      <Box>
        <Text as="div" size="md" weight="semibold" mb="2">
          Human-in-the-Loop
        </Text>
        <Checkbox
          label={`Require confirmation from ${CONFIRMER[holder]}`}
          value={value.requireConfirmation}
          setValue={(requireConfirmation) =>
            setValue({ ...value, requireConfirmation })
          }
        />
        {value.requireConfirmation && !editingRules && (
          <Flex align="center" gap="1" pl="5" mt="2">
            <Text color="text-mid">
              Requires confirmation for{" "}
              <Tooltip
                content={allActions ? PRESET_HELP.all : PRESET_HELP.recommended}
              >
                <strong tabIndex={0}>
                  {allActions ? "all" : "recommended"} actions{" "}
                  <PiInfo style={{ position: "relative", top: "-1px" }} />
                </strong>
              </Tooltip>
            </Text>
            <Link ml="2" weight="medium" onClick={() => setEditingRules(true)}>
              Customize behavior
            </Link>
          </Flex>
        )}
        {value.requireConfirmation && editingRules && (
          <Box mt="3" pl="5">
            <ConfirmRulesField
              value={value.rules}
              // Removing every rule goes back to the recommended ones.
              setValue={(next) => {
                setValue({
                  ...value,
                  rules: next.length ? next : SUGGESTED_CONFIRM_RULES,
                });
                if (!next.length) setEditingRules(false);
              }}
            />
          </Box>
        )}
      </Box>
    </Flex>
  );
}
