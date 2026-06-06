import React, { FC, ReactNode, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiEye, PiMinusCircle, PiCaretRightFill } from "react-icons/pi";
import { type HealthSignalBehavior } from "shared/validators";
import SelectField from "@/components/Forms/SelectField";

import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import { Popover } from "@/ui/Popover";

const DEFAULT_GRACE_PERIOD_HOURS = 24;

const SIGNAL_ACTION_OPTIONS: {
  value: string;
  label: string;
  color: "amber" | "red";
  icon: ReactNode;
}[] = [
  {
    value: "warn",
    label: "Review",
    color: "amber",
    icon: <PiEye color="gray" />,
  },
  {
    value: "rollback",
    label: "Rollback",
    color: "red",
    icon: <PiMinusCircle color="red" />,
  },
];

function formatActionLabel(option: { label?: string; value: string }) {
  const match = SIGNAL_ACTION_OPTIONS.find((o) => o.value === option.value);
  if (!match) return option.label ?? option.value;
  return (
    <Flex align="center" gap="1">
      <Text color={match.color}>{match.icon}</Text>
      <Text color={match.color}>{match.label}</Text>
    </Flex>
  );
}

type SignalAction = "warn" | "hold" | "rollback";

export interface HealthSignalSettingsProps {
  orgDefaults: Partial<HealthSignalBehavior> | undefined;
  overrides: {
    srmAction: SignalAction | null;
    noTrafficAction: SignalAction | null;
    multipleExposureAction: SignalAction | null;
  };
  isOverriding: boolean;
  onToggleOverride: (next: boolean) => void;
  onChangeSignal: (
    key: "srmAction" | "noTrafficAction" | "multipleExposureAction",
    value: SignalAction,
  ) => void;
  gracePeriodHours: number | null;
  onChangeGracePeriod: (value: number | null) => void;

  orgAutoRollbackDefault: boolean;
  autoRollbackEnabled: boolean | null;
  onChangeAutoRollback: (value: boolean | null) => void;

  orgHoldProgressionDefault: boolean;
  holdProgressionEnabled: boolean | null;
  onChangeHoldProgression: (value: boolean | null) => void;
  showHoldProgression?: boolean;
}

function GracePopoverContent({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue: number | null;
  onSave: (value: number | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(
    initialValue !== null ? String(initialValue) : "",
  );

  const save = () => {
    const val = parseFloat(draft);
    onSave(val && val > 0 ? Math.floor(val * 100) / 100 : null);
    onClose();
  };

  return (
    <Flex direction="column" gap="3" style={{ width: 210 }}>
      <Text weight="medium" size="medium">
        No-traffic grace period
      </Text>
      <Text as="span" size="small" color="text-mid">
        Wait before checking for no traffic. Empty defaults to{" "}
        {DEFAULT_GRACE_PERIOD_HOURS}h.
      </Text>
      <Field
        type="number"
        step="any"
        placeholder={`${DEFAULT_GRACE_PERIOD_HOURS} (default)`}
        autoFocus
        append="hours"
        onFocus={(e) => e.target.select()}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      />
      <Flex justify="end" gap="2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Done
        </Button>
      </Flex>
    </Flex>
  );
}

const HealthSignalSettings: FC<HealthSignalSettingsProps> = ({
  orgDefaults,
  overrides,
  isOverriding,
  onToggleOverride,
  onChangeSignal,
  gracePeriodHours,
  onChangeGracePeriod,
  orgAutoRollbackDefault,
  autoRollbackEnabled,
  onChangeAutoRollback,
  orgHoldProgressionDefault,
  holdProgressionEnabled,
  onChangeHoldProgression,
  showHoldProgression = false,
}) => {
  const [graceOpen, setGraceOpen] = useState(false);

  const signalDefault = (
    key: "srmAction" | "noTrafficAction" | "multipleExposureAction",
  ): SignalAction => (orgDefaults?.[key] as SignalAction | undefined) ?? "warn";

  const effectiveGrace =
    gracePeriodHours ??
    orgDefaults?.noTrafficGracePeriodHours ??
    DEFAULT_GRACE_PERIOD_HOURS;

  const signalRows: {
    key: "srmAction" | "noTrafficAction" | "multipleExposureAction";
    label: React.ReactNode;
  }[] = [
    { key: "srmAction", label: "SRM detected" },
    { key: "multipleExposureAction", label: "Multiple exposures" },
    {
      key: "noTrafficAction",
      label: (
        <Text as="span" weight="medium">
          {"No traffic ("}
          <Popover
            open={graceOpen}
            onOpenChange={setGraceOpen}
            triggerAsChild
            showArrow={false}
            align="center"
            side="top"
            trigger={
              <Link
                type="button"
                className="hover-underline"
                onClick={(e) => e.stopPropagation()}
              >
                {effectiveGrace}h
              </Link>
            }
            content={
              <GracePopoverContent
                initialValue={gracePeriodHours}
                onSave={(val) => onChangeGracePeriod(val)}
                onClose={() => setGraceOpen(false)}
              />
            }
            contentStyle={{ padding: "12px 16px" }}
          />
          {")"}
        </Text>
      ),
    },
  ];

  const [detailsOpen, setDetailsOpen] = useState(isOverriding);

  const ACTION_LABELS: Record<string, string> = {
    warn: "Review",
    hold: "Review",
    rollback: "Rollback",
  };
  const SIGNAL_SHORT: {
    key: "srmAction" | "noTrafficAction" | "multipleExposureAction";
    abbr: string;
  }[] = [
    { key: "srmAction", abbr: "SRM" },
    { key: "multipleExposureAction", abbr: "ME" },
    { key: "noTrafficAction", abbr: "No traffic" },
  ];

  function buildSummary(source: "default" | "custom"): string {
    const resolve = (
      key: "srmAction" | "noTrafficAction" | "multipleExposureAction",
    ): string => {
      if (source === "custom") {
        return ACTION_LABELS[overrides[key] ?? signalDefault(key)] ?? "Review";
      }
      return ACTION_LABELS[signalDefault(key)] ?? "Review";
    };

    const grouped: Record<string, string[]> = {};
    for (const s of SIGNAL_SHORT) {
      const action = resolve(s.key);
      if (!grouped[action]) grouped[action] = [];
      grouped[action].push(s.abbr);
    }
    return Object.entries(grouped)
      .map(([action, signals]) => `${signals.join(", ")}: ${action}`)
      .join(". ");
  }

  const signalFields = (
    <Flex direction="column" gap="2" mt="2">
      {signalRows.map((f) => {
        const effectiveValue: SignalAction = isOverriding
          ? (overrides[f.key] ?? signalDefault(f.key))
          : signalDefault(f.key);
        return (
          <Flex key={f.key} align="center" gap="3">
            <Box style={{ width: 160, flexShrink: 0 }}>
              {typeof f.label === "string" ? (
                <Text as="div" weight="medium">
                  {f.label}
                </Text>
              ) : (
                f.label
              )}
            </Box>
            <Box style={{ flexGrow: 1, maxWidth: 240 }}>
              <SelectField
                disabled={!isOverriding}
                value={effectiveValue}
                onChange={(v) => onChangeSignal(f.key, v as SignalAction)}
                options={SIGNAL_ACTION_OPTIONS}
                sort={false}
                isSearchable={false}
                formatOptionLabel={formatActionLabel}
              />
            </Box>
          </Flex>
        );
      })}
    </Flex>
  );

  const autoRollbackEffective = autoRollbackEnabled ?? orgAutoRollbackDefault;
  const holdProgressionEffective =
    holdProgressionEnabled ?? orgHoldProgressionDefault;

  const autoRollbackSelect = (
    <Flex align="center" gap="3" mt="2">
      <Box style={{ width: 160, flexShrink: 0 }}>
        <Text as="div" weight="medium">
          Auto-rollback
        </Text>
      </Box>
      <Box style={{ flexGrow: 1, maxWidth: 240 }}>
        <SelectField
          value={
            autoRollbackEnabled === null
              ? "default"
              : autoRollbackEffective
                ? "on"
                : "off"
          }
          onChange={(v) => {
            if (v === "default") onChangeAutoRollback(null);
            else onChangeAutoRollback(v === "on");
          }}
          options={[
            {
              value: "default",
              label: `Default (${orgAutoRollbackDefault ? "On" : "Off"})`,
            },
            { value: "off", label: "Off (notify only)" },
            { value: "on", label: "On (auto-stop)" },
          ]}
          sort={false}
          isSearchable={false}
          formatOptionLabel={({ value, label }) =>
            value === "default" ? (
              <em className="text-muted">{label}</em>
            ) : (
              label
            )
          }
        />
      </Box>
    </Flex>
  );

  const holdProgressionSelect = showHoldProgression ? (
    <Flex align="center" gap="3" mt="2">
      <Box style={{ width: 160, flexShrink: 0 }}>
        <Text as="div" weight="medium">
          Hold progression
        </Text>
      </Box>
      <Box style={{ flexGrow: 1, maxWidth: 240 }}>
        <SelectField
          value={
            holdProgressionEnabled === null
              ? "default"
              : holdProgressionEffective
                ? "on"
                : "off"
          }
          onChange={(v) => {
            if (v === "default") onChangeHoldProgression(null);
            else onChangeHoldProgression(v === "on");
          }}
          options={[
            {
              value: "default",
              label: `Default (${orgHoldProgressionDefault ? "On" : "Off"})`,
            },
            { value: "off", label: "Off (advance anyway)" },
            { value: "on", label: "On (pause on issues)" },
          ]}
          sort={false}
          isSearchable={false}
          formatOptionLabel={({ value, label }) =>
            value === "default" ? (
              <em className="text-muted">{label}</em>
            ) : (
              label
            )
          }
        />
      </Box>
    </Flex>
  ) : null;

  return (
    <Box>
      <SelectField
        value={isOverriding ? "custom" : "default"}
        onChange={(v) => {
          const next = v === "custom";
          onToggleOverride(next);
          setDetailsOpen(next);
        }}
        options={[
          {
            value: "default",
            label: `Default (${buildSummary("default")})`,
          },
          {
            value: "custom",
            label: "Custom",
          },
        ]}
        sort={false}
        isSearchable={false}
        formatOptionLabel={({ value, label }) =>
          value === "default" ? (
            <em className="text-muted">{label}</em>
          ) : (
            label
          )
        }
      />
      <Box mt="1">
        <Link onClick={() => setDetailsOpen(!detailsOpen)}>
          <PiCaretRightFill
            className="mr-1"
            style={{
              transform: detailsOpen ? "rotate(90deg)" : undefined,
              transition: "transform 0.15s",
            }}
          />
          Details
        </Link>
      </Box>
      {detailsOpen && (
        <Box mt="2">
          {signalFields}
          <Box mt="4">
            <Text as="div" size="small" weight="medium" color="text-mid" mb="1">
              Automation
            </Text>
            {autoRollbackSelect}
            {holdProgressionSelect}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default HealthSignalSettings;
