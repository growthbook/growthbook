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

// An override is a full copy of the base, so this is just a form over that copy.
type ScopeFieldsProps<T> = {
  idPrefix: string;
  value: T;
  onChange: (next: T) => void;
  // Read-only renders these same fields, so the two views cannot drift.
  readOnly?: boolean;
};

function LabelWithHelp({ label, help }: { label: string; help?: string }) {
  const text = label;
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

function HelpCheckbox({
  id,
  label,
  help,
  value,
  setValue,
  disabled,
}: {
  id: string;
  label: string;
  help?: string;
  value: boolean;
  setValue: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Checkbox
      id={id}
      label={<LabelWithHelp label={label} help={help} />}
      value={value}
      setValue={setValue}
      disabled={disabled}
    />
  );
}

function HelpMultiSelect({
  id,
  label,
  options,
  placeholder,
  help,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder: string;
  help?: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <Box>
      <Text as="label" size="md" weight="semibold">
        <LabelWithHelp label={label} help={help} />
      </Text>
      <MultiSelectField
        legacyHeight
        id={id}
        containerClassName="mb-0"
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
      />
    </Box>
  );
}

function CollapsibleMultiSelect({
  revealLabel,
  ...props
}: Parameters<typeof HelpMultiSelect>[0] & { revealLabel: string }) {
  const [shown, setShown] = useState(() => props.value.length > 0);
  // Nothing to reveal when read-only; the field shows what applies.
  if (!shown && !props.disabled) {
    return (
      <Box>
        <Link onClick={() => setShown(true)}>
          <PiPlus /> {revealLabel}
        </Link>
      </Box>
    );
  }
  return <HelpMultiSelect {...props} />;
}

export function FlagApprovalFields({
  idPrefix,
  value,
  onChange,
  readOnly,
}: ScopeFieldsProps<RequireReview>) {
  const { teams } = useUser();
  const environments = useEnvironments();
  const set = (patch: Partial<RequireReview>) =>
    onChange({ ...value, ...patch });

  return (
    <>
      <Checkbox
        id={`${idPrefix}-require-reviews`}
        label="Require approval to publish changes"
        value={!!value.requireReviewOn}
        setValue={(v) => onChange({ ...value, requireReviewOn: v })}
        disabled={readOnly}
      />
      {value.requireReviewOn && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          <CollapsibleMultiSelect
            revealLabel="For specific environments"
            id={`${idPrefix}-environments`}
            label="Specific environments"
            options={environments.map((e) => ({ value: e.id, label: e.id }))}
            placeholder="All environments (leave blank to gate all)"
            value={value.environments ?? []}
            onChange={(v) => set({ environments: v })}
            disabled={readOnly}
          />
          <CollapsibleMultiSelect
            revealLabel="Require approval from specific teams"
            id={`${idPrefix}-required-approver-teams`}
            label="Required approver teams"
            options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Anyone who can review (leave blank)"
            help={REQUIRED_TEAMS_HELP}
            value={value.requiredApproverTeams ?? []}
            onChange={(v) => set({ requiredApproverTeams: v })}
            disabled={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-reset-review-on-change`}
            label="Reset review on changes"
            help="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            value={!!value.resetReviewOnChange}
            setValue={(v) => set({ resetReviewOnChange: v })}
            disabled={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-block-self-approval`}
            label="Block contributors from self-approving"
            help="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            value={!!value.blockSelfApproval}
            setValue={(v) => set({ blockSelfApproval: v })}
            disabled={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            help="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a draft together."
            value={!!value.autopublishOnApproval}
            setValue={(v) => set({ autopublishOnApproval: v })}
            disabled={readOnly}
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
              <HelpCheckbox
                id={`${idPrefix}-env-review`}
                label="Enabled environment changes (kill switches)"
                value={value.featureRequireEnvironmentReview !== false}
                setValue={(v) => set({ featureRequireEnvironmentReview: v })}
                disabled={readOnly}
              />
              <HelpCheckbox
                id={`${idPrefix}-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                value={value.featureRequireMetadataReview !== false}
                setValue={(v) => set({ featureRequireMetadataReview: v })}
                disabled={readOnly}
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
  readOnly,
}: ScopeFieldsProps<ApprovalFlowConfiguration>) {
  const { teams } = useUser();
  const set = (patch: Partial<ApprovalFlowConfiguration>) =>
    onChange({ ...value, ...patch });

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
        disabled={readOnly}
      />
      {value.required && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          <CollapsibleMultiSelect
            revealLabel="Require approval from specific teams"
            id={`${idPrefix}-saved-group-required-approver-teams`}
            label="Required approver teams"
            options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Anyone who can review (leave blank)"
            help={REQUIRED_TEAMS_HELP}
            value={value.requiredApproverTeams ?? []}
            onChange={(v) => set({ requiredApproverTeams: v })}
            disabled={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-saved-group-reset-review-on-change`}
            label="Reset review on changes"
            help="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            value={!!value.resetReviewOnChange}
            setValue={(v) => set({ resetReviewOnChange: v })}
            disabled={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-saved-group-block-self-approval`}
            label="Block contributors from self-approving"
            help="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            value={!!value.blockSelfApproval}
            setValue={(v) => set({ blockSelfApproval: v })}
            disabled={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-saved-group-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            help="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a Saved Group change together."
            value={!!value.autopublishOnApproval}
            setValue={(v) => set({ autopublishOnApproval: v })}
            disabled={readOnly}
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
              <HelpCheckbox
                id={`${idPrefix}-saved-group-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                value={value.requireMetadataReview !== false}
                setValue={(v) => set({ requireMetadataReview: v })}
                disabled={readOnly}
              />
            </Flex>
          </Box>
        </Flex>
      )}
    </>
  );
}

// Both families for one scope, shared so the two surfaces cannot drift.
export function ApprovalScopeSections({
  idPrefix,
  flagRule,
  onFlagChange,
  onFlagReset,
  savedGroupRule,
  onSavedGroupChange,
  onSavedGroupReset,
  savedGroupDescription,
  readOnly,
}: {
  idPrefix: string;
  flagRule: RequireReview;
  onFlagChange: (next: RequireReview) => void;
  savedGroupRule: ApprovalFlowConfiguration;
  onSavedGroupChange: (next: ApprovalFlowConfiguration) => void;
  savedGroupDescription?: string;
  // Only on an override scope, and only while that section differs from base.
  onFlagReset?: () => void;
  onSavedGroupReset?: () => void;
  readOnly?: boolean;
}) {
  return (
    <>
      <Box>
        <SectionHeading
          title="Features, Configs, &amp; Constants"
          onReset={onFlagReset}
        />
        <Text as="p" size="md" mb="4" color="text-low">
          All changes to Feature Flags, Configs and Constants are tracked as
          revisions. Requiring approvals adds a review step before any change
          goes live.
        </Text>
        <FlagApprovalFields
          idPrefix={`flags-${idPrefix}`}
          value={flagRule}
          onChange={onFlagChange}
          readOnly={readOnly}
        />
      </Box>

      <Separator size="4" my="4" />

      <Box>
        <SectionHeading title="Saved Groups" onReset={onSavedGroupReset} />
        <Text as="p" size="md" mb="4" color="text-low">
          {savedGroupDescription ??
            "All changes to Saved Groups are tracked as revisions. Requiring approvals adds a review step before any change goes live."}
        </Text>
        <SavedGroupApprovalFields
          idPrefix={`saved-groups-${idPrefix}`}
          value={savedGroupRule}
          onChange={onSavedGroupChange}
          readOnly={readOnly}
        />
      </Box>
    </>
  );
}

function SectionHeading({
  title,
  onReset,
}: {
  title: string;
  onReset?: () => void;
}) {
  return (
    <Flex align="center" justify="between" gap="3" mb="2">
      <Heading as="h4" size="sm" weight="semibold" mb="0">
        {title}
      </Heading>
      {onReset ? (
        <Link
          size="sm"
          onClick={(e) => {
            e.preventDefault();
            onReset();
          }}
        >
          <Flex align="center" gap="1">
            <PiArrowCounterClockwise /> Reset to All Projects
          </Flex>
        </Link>
      ) : null}
    </Flex>
  );
}
