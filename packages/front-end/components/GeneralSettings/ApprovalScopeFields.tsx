import { useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowCounterClockwise, PiInfo, PiPlus } from "react-icons/pi";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";

// One scope's rule. `inherited` is the rule this scope falls back to, absent on
// the all-projects tab — which is the base and so has nothing to inherit.
type ScopeFieldsProps<T> = {
  idPrefix: string;
  value: T;
  onChange: (next: T) => void;
  inherited?: T;
};

function LabelWithHelp({
  label,
  help,
  muted,
}: {
  label: string;
  help?: string;
  // Muted means the field is still inheriting, so nothing here is an override.
  muted?: boolean;
}) {
  const text = muted ? <Text color="text-low">{label}</Text> : label;
  if (!help) return <>{text}</>;
  return (
    <Flex align="center" gap="1" asChild>
      <span>
        {text}
        <span onClick={(e) => e.stopPropagation()}>
          <Tooltip body={help}>
            <PiInfo color="var(--color-text-low)" />
          </Tooltip>
        </span>
      </span>
    </Flex>
  );
}

const REQUIRED_TEAMS_HELP =
  "A draft cannot publish until someone from one of these teams approves it. Anyone eligible can still approve alongside them.";

type FieldHandle<V> = {
  overridden: boolean;
  effective: V;
  set: (next: V) => void;
  override: () => void;
  revert: () => void;
};

// Per-field inheritance: `null` is the stored "unset" signal, so a field is
// overridden exactly when this scope's rule holds a non-null value for it.
// `whenUnset` is what the field means with no value anywhere, and seeds an
// override with exactly what was on screen — so promoting a field never flips it.
function fieldHandles<T extends object>(
  value: T,
  inherited: T | undefined,
  onChange: (next: T) => void,
) {
  return function handle<K extends keyof T>(
    key: K,
    whenUnset: NonNullable<T[K]>,
  ): FieldHandle<NonNullable<T[K]>> {
    const own = (value[key] ?? null) !== null;
    const raw = own ? value[key] : (inherited?.[key] ?? undefined);
    const effective = (raw ?? whenUnset) as NonNullable<T[K]>;
    return {
      overridden: !inherited || own,
      effective,
      set: (next) => onChange({ ...value, [key]: next }),
      override: () => onChange({ ...value, [key]: effective } as T),
      revert: () => onChange({ ...value, [key]: null } as T),
    };
  };
}

// Inheriting is the default state, so it carries no controls of its own: the
// label is muted and there is no Revert. Editing the control writes a value,
// which is what makes the field an override.
function RevertLink({ onRevert }: { onRevert: () => void }) {
  return (
    <Link
      size="sm"
      color="red"
      onClick={(e) => {
        e.preventDefault();
        onRevert();
      }}
    >
      <Flex align="center" gap="1">
        <PiArrowCounterClockwise /> Revert
      </Flex>
    </Link>
  );
}

function InheritableCheckbox({
  id,
  label,
  help,
  field,
}: {
  id: string;
  label: string;
  help?: string;
  field: FieldHandle<boolean>;
}) {
  return (
    <Flex align="center" justify="between" gap="3">
      <Checkbox
        id={id}
        label={
          <LabelWithHelp label={label} help={help} muted={!field.overridden} />
        }
        value={!!field.effective}
        setValue={field.set}
      />
      {field.overridden ? <RevertLink onRevert={field.revert} /> : null}
    </Flex>
  );
}

function InheritableMultiSelect({
  id,
  label,
  options,
  placeholder,
  help,
  field,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder: string;
  help?: string;
  field: FieldHandle<string[]>;
}) {
  return (
    <Box>
      <Flex align="center" justify="between" gap="3">
        <Text as="label" size="md" weight="semibold">
          <LabelWithHelp label={label} help={help} muted={!field.overridden} />
        </Text>
        {field.overridden ? <RevertLink onRevert={field.revert} /> : null}
      </Flex>
      <MultiSelectField
        legacyHeight
        id={id}
        containerClassName="mb-0"
        value={field.effective}
        onChange={field.set}
        options={options}
        placeholder={placeholder}
      />
    </Box>
  );
}

export function FlagApprovalFields({
  idPrefix,
  value,
  onChange,
  inherited,
}: ScopeFieldsProps<RequireReview>) {
  const { teams } = useUser();
  const environments = useEnvironments();
  const handle = fieldHandles(value, inherited, onChange);
  const envField = handle("environments", []);
  const [showEnvScope, setShowEnvScope] = useState(
    () => !!envField.effective.length || !envField.overridden,
  );

  return (
    <>
      <Checkbox
        id={`${idPrefix}-require-reviews`}
        label="Require approval to publish changes"
        value={!!value.requireReviewOn}
        setValue={(v) => onChange({ ...value, requireReviewOn: v })}
      />
      {value.requireReviewOn && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          {showEnvScope ? (
            <InheritableMultiSelect
              id={`${idPrefix}-environments`}
              label="Specific environments"
              options={environments.map((e) => ({ value: e.id, label: e.id }))}
              placeholder="All environments (leave blank to gate all)"
              field={envField}
            />
          ) : (
            <Link onClick={() => setShowEnvScope(true)}>
              <PiPlus /> For specific environments
            </Link>
          )}
          <InheritableMultiSelect
            id={`${idPrefix}-required-approver-teams`}
            label="Required approver teams"
            options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Anyone who can review (leave blank)"
            help={REQUIRED_TEAMS_HELP}
            field={handle("requiredApproverTeams", [])}
          />
          <InheritableCheckbox
            id={`${idPrefix}-reset-review-on-change`}
            label="Reset review on changes"
            help="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            field={handle("resetReviewOnChange", false)}
          />
          <InheritableCheckbox
            id={`${idPrefix}-block-self-approval`}
            label="Block contributors from self-approving"
            help="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            field={handle("blockSelfApproval", false)}
          />
          <InheritableCheckbox
            id={`${idPrefix}-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            help="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a draft together."
            field={handle("autopublishOnApproval", false)}
          />
          <Box mt="2">
            <Text as="label" size="md" weight="semibold" mb="2">
              Require approval for
            </Text>
            <Flex direction="column" gap="2" align="start">
              <Checkbox
                id={`${idPrefix}-rules-values`}
                label="Rules, values, and prerequisites"
                value={true}
                disabled={true}
                setValue={() => undefined}
              />
              <InheritableCheckbox
                id={`${idPrefix}-env-review`}
                label="Enabled environment changes (kill switches)"
                field={handle("featureRequireEnvironmentReview", true)}
              />
              <InheritableCheckbox
                id={`${idPrefix}-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                field={handle("featureRequireMetadataReview", true)}
              />
            </Flex>
          </Box>
        </Flex>
      )}
    </>
  );
}

export function SavedGroupApprovalFields({
  idPrefix,
  value,
  onChange,
  inherited,
}: ScopeFieldsProps<ApprovalFlowConfiguration>) {
  const { teams } = useUser();
  const handle = fieldHandles(value, inherited, onChange);

  return (
    <>
      <Checkbox
        id={`${idPrefix}-require-approvals-saved-groups`}
        label={
          <LabelWithHelp
            label="Require approval to modify Saved Groups"
            help="When enabled, all changes to Saved Groups must be reviewed and approved by another person before going live."
          />
        }
        value={!!value.required}
        setValue={(v) => onChange({ ...value, required: v })}
      />
      {value.required && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          <InheritableMultiSelect
            id={`${idPrefix}-saved-group-required-approver-teams`}
            label="Required approver teams"
            options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Anyone who can review (leave blank)"
            help={REQUIRED_TEAMS_HELP}
            field={handle("requiredApproverTeams", [])}
          />
          <InheritableCheckbox
            id={`${idPrefix}-saved-group-reset-review-on-change`}
            label="Reset review on changes"
            help="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            field={handle("resetReviewOnChange", false)}
          />
          <InheritableCheckbox
            id={`${idPrefix}-saved-group-block-self-approval`}
            label="Block contributors from self-approving"
            help="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            field={handle("blockSelfApproval", false)}
          />
          <InheritableCheckbox
            id={`${idPrefix}-saved-group-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            help="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a Saved Group change together."
            field={handle("autopublishOnApproval", false)}
          />
          <Box mt="2">
            <Text as="label" size="md" weight="semibold" mb="2">
              Require approval for
            </Text>
            <Flex direction="column" gap="2" align="start">
              <Checkbox
                id={`${idPrefix}-saved-group-values-conditions`}
                label="Values and conditions"
                value={true}
                disabled={true}
                setValue={() => undefined}
              />
              <InheritableCheckbox
                id={`${idPrefix}-saved-group-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                field={handle("requireMetadataReview", true)}
              />
            </Flex>
          </Box>
        </Flex>
      )}
    </>
  );
}

// Both families for one scope, in the order the org settings and the project
// page both present them. Shared so the two surfaces cannot drift.
export function ApprovalScopeSections({
  idPrefix,
  flagRule,
  onFlagChange,
  inheritedFlagRule,
  savedGroupRule,
  onSavedGroupChange,
  inheritedSavedGroupRule,
  savedGroupDescription,
}: {
  idPrefix: string;
  flagRule: RequireReview;
  onFlagChange: (next: RequireReview) => void;
  inheritedFlagRule?: RequireReview;
  savedGroupRule: ApprovalFlowConfiguration;
  onSavedGroupChange: (next: ApprovalFlowConfiguration) => void;
  inheritedSavedGroupRule?: ApprovalFlowConfiguration;
  savedGroupDescription?: string;
}) {
  return (
    <>
      <Box>
        <Heading as="h4" size="sm" weight="semibold" mb="2">
          Features, Configs, &amp; Constants
        </Heading>
        <Text as="p" size="md" mb="4" color="text-low">
          All changes to Feature Flags, Configs and Constants are tracked as
          revisions. Requiring approvals adds a review step before any change
          goes live. Kill switch changes always prompt a confirmation regardless
          of approval settings.
        </Text>
        <FlagApprovalFields
          idPrefix={`flags-${idPrefix}`}
          value={flagRule}
          onChange={onFlagChange}
          inherited={inheritedFlagRule}
        />
      </Box>

      <Separator size="4" my="4" />

      <Box>
        <Heading as="h4" size="sm" weight="semibold" mb="2">
          Saved Groups
        </Heading>
        <Text as="p" size="md" mb="4" color="text-low">
          {savedGroupDescription ??
            "All changes to Saved Groups are tracked as revisions. Requiring approvals adds a review step before any change goes live."}
        </Text>
        <SavedGroupApprovalFields
          idPrefix={`saved-groups-${idPrefix}`}
          value={savedGroupRule}
          onChange={onSavedGroupChange}
          inherited={inheritedSavedGroupRule}
        />
      </Box>
    </>
  );
}
