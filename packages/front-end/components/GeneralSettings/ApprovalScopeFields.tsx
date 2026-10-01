import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  PiArrowCounterClockwise,
  PiCheck,
  PiInfo,
  PiPlus,
  PiX,
} from "react-icons/pi";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";
import { ApprovalFlowFamily } from "./approvalScopes";

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

// Read-only shows the same fields as plain content: a disabled form control
// still reads as something you were meant to be able to change.
function StaticCheck({
  checked,
  label,
}: {
  checked: boolean;
  label: ReactNode;
}) {
  return (
    <Flex align="center" gap="2">
      {checked ? (
        <PiCheck color="var(--color-text-mid)" />
      ) : (
        <PiX color="var(--color-text-low)" />
      )}
      <Text color={checked ? "text-mid" : "text-low"}>{label}</Text>
    </Flex>
  );
}

function HelpCheckbox({
  id,
  label,
  help,
  value,
  setValue,
  disabled,
  readOnly,
}: {
  id: string;
  label: string;
  help?: string;
  value: boolean;
  setValue: (next: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <StaticCheck
        checked={value}
        label={<LabelWithHelp label={label} help={help} />}
      />
    );
  }
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
  emptyLabel,
  help,
  value,
  onChange,
  disabled,
  readOnly,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  placeholder: string;
  emptyLabel: string;
  help?: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  // The select silently drops a team or environment that has been deleted, so
  // the requirement stops applying with nothing on screen to say why.
  const missing = value.filter((v) => !options.some((o) => o.value === v));
  const chosen = value.map(
    (v) => options.find((o) => o.value === v)?.label ?? v,
  );

  return (
    <Box>
      <Text as="label" size="md" weight="semibold">
        <LabelWithHelp label={label} help={help} />
      </Text>
      {readOnly ? (
        <Text as="div" color={chosen.length ? "text-mid" : "text-low"}>
          {chosen.length ? chosen.join(", ") : emptyLabel}
        </Text>
      ) : (
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
      )}
      {missing.length > 0 && (
        <Callout status="warning" size="sm" mt="1">
          No longer exists, so this no longer applies: {missing.join(", ")}.
          Saving removes it.
        </Callout>
      )}
    </Box>
  );
}

function CollapsibleMultiSelect({
  revealLabel,
  ...props
}: Parameters<typeof HelpMultiSelect>[0] & { revealLabel: string }) {
  const [shown, setShown] = useState(() => props.value.length > 0);
  // Nothing to reveal when read-only; the field shows what applies.
  if (!shown && !props.readOnly) {
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
      <HelpCheckbox
        id={`${idPrefix}-require-reviews`}
        label="Require approval to publish changes"
        value={!!value.requireReviewOn}
        setValue={(v) => onChange({ ...value, requireReviewOn: v })}
        readOnly={readOnly}
      />
      {value.requireReviewOn && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          <CollapsibleMultiSelect
            revealLabel="For specific environments"
            id={`${idPrefix}-environments`}
            label="Specific environments"
            options={environments.map((e) => ({ value: e.id, label: e.id }))}
            placeholder="All environments (leave blank to gate all)"
            emptyLabel="All environments"
            value={value.environments ?? []}
            onChange={(v) => set({ environments: v })}
            readOnly={readOnly}
          />
          <CollapsibleMultiSelect
            revealLabel="Require approval from specific teams"
            id={`${idPrefix}-required-approver-teams`}
            label="Required approver teams"
            options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Anyone who can review (leave blank)"
            help={REQUIRED_TEAMS_HELP}
            emptyLabel="Anyone who can review"
            value={value.requiredApproverTeams ?? []}
            onChange={(v) => set({ requiredApproverTeams: v })}
            readOnly={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-reset-review-on-change`}
            label="Reset review on changes"
            help="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            value={!!value.resetReviewOnChange}
            setValue={(v) => set({ resetReviewOnChange: v })}
            readOnly={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-block-self-approval`}
            label="Block contributors from self-approving"
            help="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            value={!!value.blockSelfApproval}
            setValue={(v) => set({ blockSelfApproval: v })}
            readOnly={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            help="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a draft together."
            value={!!value.autopublishOnApproval}
            setValue={(v) => set({ autopublishOnApproval: v })}
            readOnly={readOnly}
          />
          <Box mt="2">
            <Text as="label" size="md" weight="semibold" mb="2">
              Require approval for
            </Text>
            <Flex direction="column" gap="2" align="start">
              <HelpCheckbox
                id={`${idPrefix}-rules-values`}
                label="Rules, values, and prerequisites"
                value={true}
                disabled={true}
                readOnly={readOnly}
                setValue={() => undefined}
              />
              <HelpCheckbox
                id={`${idPrefix}-env-review`}
                label="Enabled environment changes (kill switches)"
                value={value.featureRequireEnvironmentReview !== false}
                setValue={(v) => set({ featureRequireEnvironmentReview: v })}
                readOnly={readOnly}
              />
              <HelpCheckbox
                id={`${idPrefix}-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                value={value.featureRequireMetadataReview !== false}
                setValue={(v) => set({ featureRequireMetadataReview: v })}
                readOnly={readOnly}
              />
            </Flex>
          </Box>
        </Flex>
      )}
    </>
  );
}

const APPROVAL_FLOW_COPY: Record<
  ApprovalFlowFamily,
  {
    idInfix: string;
    requireId: string;
    requireLabel: string;
    requireHelp: string;
    autopublishHelp: string;
    contentId: string;
    contentLabel: string;
    metadataLabel: string;
  }
> = {
  "saved-group": {
    idInfix: "saved-group",
    requireId: "require-approvals-saved-groups",
    requireLabel: "Require approval to modify Saved Groups",
    requireHelp:
      "When enabled, all changes to Saved Groups must be reviewed and approved by another person before going live.",
    autopublishHelp:
      "Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a Saved Group change together.",
    contentId: "values-conditions",
    contentLabel: "Values and conditions",
    metadataLabel: "Metadata changes (description, owner, project, tags, etc.)",
  },
  "sdk-connection": {
    idInfix: "sdk-connection",
    requireId: "require-approvals-sdk-connections",
    requireLabel: "Require approval to modify SDK Connections",
    requireHelp:
      "When enabled, all changes to SDK Connections must be reviewed and approved by another person before going live.",
    autopublishHelp:
      "Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish an SDK Connection change together.",
    contentId: "settings",
    contentLabel:
      "Connection settings (projects, environment, payload options)",
    metadataLabel: "Metadata changes (name)",
  },
};

export function ApprovalFlowRuleFields({
  family,
  idPrefix,
  value,
  onChange,
  readOnly,
}: ScopeFieldsProps<ApprovalFlowConfiguration> & {
  family: ApprovalFlowFamily;
}) {
  const { teams } = useUser();
  const environments = useEnvironments();
  const copy = APPROVAL_FLOW_COPY[family];
  const set = (patch: Partial<ApprovalFlowConfiguration>) =>
    onChange({ ...value, ...patch });

  return (
    <>
      <HelpCheckbox
        id={`${idPrefix}-${copy.requireId}`}
        label={copy.requireLabel}
        help={copy.requireHelp}
        value={!!value.required}
        setValue={(v) => onChange({ ...value, required: v })}
        readOnly={readOnly}
      />
      {value.required && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          {family === "sdk-connection" && (
            <CollapsibleMultiSelect
              revealLabel="For specific environments"
              id={`${idPrefix}-${copy.idInfix}-environments`}
              label="Specific environments"
              options={environments.map((e) => ({ value: e.id, label: e.id }))}
              placeholder="All environments (leave blank to gate all)"
              help="An SDK Connection serves one environment, so only connections in these environments need approval."
              emptyLabel="All environments"
              value={value.environments ?? []}
              onChange={(v) => set({ environments: v })}
              readOnly={readOnly}
            />
          )}
          <CollapsibleMultiSelect
            revealLabel="Require approval from specific teams"
            id={`${idPrefix}-${copy.idInfix}-required-approver-teams`}
            label="Required approver teams"
            options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Anyone who can review (leave blank)"
            help={REQUIRED_TEAMS_HELP}
            emptyLabel="Anyone who can review"
            value={value.requiredApproverTeams ?? []}
            onChange={(v) => set({ requiredApproverTeams: v })}
            readOnly={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-${copy.idInfix}-reset-review-on-change`}
            label="Reset review on changes"
            help="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            value={!!value.resetReviewOnChange}
            setValue={(v) => set({ resetReviewOnChange: v })}
            readOnly={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-${copy.idInfix}-block-self-approval`}
            label="Block contributors from self-approving"
            help="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            value={!!value.blockSelfApproval}
            setValue={(v) => set({ blockSelfApproval: v })}
            readOnly={readOnly}
          />
          <HelpCheckbox
            id={`${idPrefix}-${copy.idInfix}-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            help={copy.autopublishHelp}
            value={!!value.autopublishOnApproval}
            setValue={(v) => set({ autopublishOnApproval: v })}
            readOnly={readOnly}
          />
          <Box mt="2">
            <Text as="label" size="md" weight="semibold" mb="2">
              Require approval for
            </Text>
            <Flex direction="column" gap="2" align="start">
              <HelpCheckbox
                id={`${idPrefix}-${copy.idInfix}-${copy.contentId}`}
                label={copy.contentLabel}
                value={true}
                disabled={true}
                readOnly={readOnly}
                setValue={() => undefined}
              />
              <HelpCheckbox
                id={`${idPrefix}-${copy.idInfix}-metadata-review`}
                label={copy.metadataLabel}
                value={value.requireMetadataReview !== false}
                setValue={(v) => set({ requireMetadataReview: v })}
                readOnly={readOnly}
              />
            </Flex>
          </Box>
        </Flex>
      )}
    </>
  );
}

// Every family for one scope, shared so the two surfaces cannot drift.
export function ApprovalScopeSections({
  idPrefix,
  flagRule,
  onFlagChange,
  onFlagReset,
  savedGroupRule,
  onSavedGroupChange,
  onSavedGroupReset,
  savedGroupDescription,
  sdkConnectionRule,
  onSdkConnectionChange,
  onSdkConnectionReset,
  readOnly,
}: {
  idPrefix: string;
  flagRule: RequireReview;
  onFlagChange: (next: RequireReview) => void;
  savedGroupRule: ApprovalFlowConfiguration;
  onSavedGroupChange: (next: ApprovalFlowConfiguration) => void;
  savedGroupDescription?: string;
  sdkConnectionRule?: ApprovalFlowConfiguration;
  onSdkConnectionChange?: (next: ApprovalFlowConfiguration) => void;
  // Only on an override scope, and only while that section differs from base.
  onFlagReset?: () => void;
  onSavedGroupReset?: () => void;
  onSdkConnectionReset?: () => void;
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
        <ApprovalFlowRuleFields
          family="saved-group"
          idPrefix={`saved-groups-${idPrefix}`}
          value={savedGroupRule}
          onChange={onSavedGroupChange}
          readOnly={readOnly}
        />
      </Box>

      {sdkConnectionRule && onSdkConnectionChange ? (
        <>
          <Separator size="4" my="4" />

          <Box>
            <SectionHeading
              title="SDK Connections"
              onReset={onSdkConnectionReset}
            />
            <Text as="p" size="md" mb="4" color="text-low">
              All changes to SDK Connections are tracked as revisions. Requiring
              approvals adds a review step before any change goes live.
            </Text>
            <ApprovalFlowRuleFields
              family="sdk-connection"
              idPrefix={`sdk-connections-${idPrefix}`}
              value={sdkConnectionRule}
              onChange={onSdkConnectionChange}
              readOnly={readOnly}
            />
          </Box>
        </>
      ) : null}
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
