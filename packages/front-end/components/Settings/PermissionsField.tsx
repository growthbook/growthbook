import { useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import RadioCards from "@/ui/RadioCards";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { useUser } from "@/services/UserContext";
import useOrgLimits from "@/hooks/useOrgLimits";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import ConfirmRulesField, {
  SUGGESTED_CONFIRM_RULES,
} from "./ConfirmRulesField";
import { ALL, presetOf } from "./confirmRulesUtils";
import {
  Allowed,
  canCustomize,
  Holder,
  PermissionsValue,
  Preset,
  PRESET_LABELS,
  presetAllowed,
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

// The server rejects a role the plan lacks or the org deactivated, and
// confirmations without Enterprise.
export function useAllowedPermissions(): Allowed {
  const { organization, hasCommercialFeature } = useUser();
  const { orgSupportsRoles } = useOrgLimits();
  const roles = orgSupportsRoles();
  return {
    roles,
    readonly: roles && !organization.deactivatedRoles?.includes("readonly"),
    confirmations: hasCommercialFeature("human-in-the-loop"),
  };
}

// What each preset does, for whoever holds the credential.
export const presetDescriptions = (holder: Holder): Record<Preset, string> => ({
  readonly: "Can read, but every write is blocked.",
  hitl: `Risky or destructive actions wait for ${CONFIRMER[holder]} to confirm.`,
  full: FULL_ACCESS[holder],
});

export default function PermissionsField({
  holder,
  value,
  setValue,
  allowed,
}: {
  holder: Holder;
  value: PermissionsValue;
  setValue: (value: PermissionsValue) => void;
  allowed: Allowed;
}) {
  const descriptions = presetDescriptions(holder);
  const labels: Record<Preset, string | JSX.Element> = {
    ...PRESET_LABELS,
    hitl: (
      <>
        {PRESET_LABELS.hitl}{" "}
        <PaidFeatureBadge commercialFeature="human-in-the-loop" ml="1" />
      </>
    ),
  };
  const disabledReason: Partial<Record<Preset, string>> = {
    readonly: allowed.roles
      ? "Your organization has deactivated the Read Only role."
      : "Your plan only supports the admin role.",
    hitl: "Human-in-the-Loop requires an Enterprise plan.",
  };

  return (
    <Box>
      <Flex justify="between" align="center" mb="2">
        <Text as="div" size="md" weight="semibold">
          Permissions
        </Text>
        {(value.customizing || canCustomize(allowed)) && (
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
        )}
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
            // A disabled card gets no hover, so the reason replaces its description.
            ...(presetAllowed(preset, allowed)
              ? { description: descriptions[preset] }
              : { description: disabledReason[preset], disabled: true }),
          }))}
        />
      ) : (
        <CustomPermissions
          holder={holder}
          value={value}
          setValue={setValue}
          allowed={allowed}
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
  allowed,
}: {
  holder: Holder;
  value: PermissionsValue;
  setValue: (value: PermissionsValue) => void;
  allowed: Allowed;
}) {
  // A token or User key acts as a person, so its role is optional and only
  // narrows them. A System key's role is everything it can do.
  const actsAsPerson = holder !== "system";
  // Unchecking and checking again brings back the rules that were set.
  const restrictedScope = useRef(
    value.restricted
      ? value.scope
      : presetValue(allowed.readonly ? "readonly" : "full").scope,
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
      forApiKey
    />
  );

  return (
    <Flex direction="column" gap="5">
      {allowed.roles && !actsAsPerson && roleTable}
      {allowed.roles && actsAsPerson && (
        <Box>
          <Checkbox
            label="Restrict permissions"
            value={value.restricted}
            setValue={(restricted) => {
              if (!restricted) restrictedScope.current = value.scope;
              setValue({
                ...value,
                restricted,
                scope: restricted
                  ? restrictedScope.current
                  : presetValue("full").scope,
              });
            }}
          />
          {value.restricted && (
            <Flex direction="column" gap="3" mt="3" pl="5">
              <Callout status="info">{OVERLAP[holder]}</Callout>
              {roleTable}
            </Flex>
          )}
        </Box>
      )}
      <Box>
        <Text as="div" size="md" weight="semibold" mb="2">
          Human-in-the-Loop{" "}
          <PaidFeatureBadge commercialFeature="human-in-the-loop" ml="1" />
        </Text>
        <Checkbox
          label={`Require confirmation from ${CONFIRMER[holder]}`}
          // A key that already has confirmations can still turn them off.
          disabled={!allowed.confirmations && !value.requireConfirmation}
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
