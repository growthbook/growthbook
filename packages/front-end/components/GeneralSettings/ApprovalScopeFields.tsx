import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import {
  ApprovalFlowConfiguration,
  RequireReview,
} from "shared/types/organization";
import { useState } from "react";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";

// One scope's rule, rendered the same way wherever it is edited: the org
// settings tabs and the project page both mount these.
type FieldsProps<T> = {
  value: T;
  onChange: (next: T) => void;
  // Distinguishes the control ids when several scopes render at once.
  idPrefix: string;
};

const REQUIRED_TEAMS_HELP =
  "A draft cannot publish until someone from one of these teams approves it. Anyone eligible can still approve alongside them.";

function RequiredApproverTeams({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { teams } = useUser();
  return (
    <MultiSelectField
      legacyHeight
      id={id}
      label="Required approver teams"
      labelClassName="font-weight-semibold"
      containerClassName="mb-0"
      value={value}
      onChange={onChange}
      options={(teams ?? []).map((t) => ({ value: t.id, label: t.name }))}
      placeholder="Anyone who can review (leave blank)"
      helpText={REQUIRED_TEAMS_HELP}
    />
  );
}

export function FlagApprovalFields({
  value,
  onChange,
  idPrefix,
}: FieldsProps<RequireReview>) {
  const environments = useEnvironments();
  const [showEnvScope, setShowEnvScope] = useState(
    !!value.environments?.length,
  );
  const set = (patch: Partial<RequireReview>) =>
    onChange({ ...value, ...patch });

  return (
    <>
      <Checkbox
        id={`${idPrefix}-require-reviews`}
        label="Require approval to publish changes"
        value={!!value.requireReviewOn}
        setValue={(v) => set({ requireReviewOn: v })}
      />
      {value.requireReviewOn && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          {showEnvScope ? (
            <MultiSelectField
              legacyHeight
              id={`${idPrefix}-environments`}
              label="Specific environments"
              labelClassName="font-weight-semibold"
              containerClassName="mb-0"
              value={value.environments ?? []}
              onChange={(v) => set({ environments: v })}
              options={environments.map((e) => ({ value: e.id, label: e.id }))}
              placeholder="All environments (leave blank to gate all)"
            />
          ) : (
            <Link onClick={() => setShowEnvScope(true)}>
              <PiPlus /> For specific environments
            </Link>
          )}
          <RequiredApproverTeams
            id={`${idPrefix}-required-approver-teams`}
            value={value.requiredApproverTeams ?? []}
            onChange={(v) => set({ requiredApproverTeams: v })}
          />
          <Checkbox
            id={`${idPrefix}-reset-review-on-change`}
            label="Reset review on changes"
            description="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            value={!!value.resetReviewOnChange}
            setValue={(v) => set({ resetReviewOnChange: v })}
          />
          <Checkbox
            id={`${idPrefix}-block-self-approval`}
            label="Block contributors from self-approving"
            description="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            value={!!value.blockSelfApproval}
            setValue={(v) => set({ blockSelfApproval: v })}
          />
          <Checkbox
            id={`${idPrefix}-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            description="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a draft together."
            value={!!value.autopublishOnApproval}
            setValue={(v) => set({ autopublishOnApproval: v })}
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
              <Checkbox
                id={`${idPrefix}-env-review`}
                label="Enabled environment changes (kill switches)"
                value={value.featureRequireEnvironmentReview !== false}
                setValue={(v) => set({ featureRequireEnvironmentReview: v })}
              />
              <Checkbox
                id={`${idPrefix}-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                value={value.featureRequireMetadataReview !== false}
                setValue={(v) => set({ featureRequireMetadataReview: v })}
              />
            </Flex>
          </Box>
        </Flex>
      )}
    </>
  );
}

export function SavedGroupApprovalFields({
  value,
  onChange,
  idPrefix,
}: FieldsProps<ApprovalFlowConfiguration>) {
  const set = (patch: Partial<ApprovalFlowConfiguration>) =>
    onChange({ ...value, ...patch });

  return (
    <>
      <Checkbox
        id={`${idPrefix}-require-approvals-saved-groups`}
        label="Require approval to modify Saved Groups"
        description="When enabled, all changes to Saved Groups must be reviewed and approved by another person before going live."
        value={!!value.required}
        setValue={(v) => set({ required: v })}
      />
      {value.required && (
        <Flex direction="column" gap="3" mt="2" ml="5">
          <RequiredApproverTeams
            id={`${idPrefix}-saved-group-required-approver-teams`}
            value={value.requiredApproverTeams ?? []}
            onChange={(v) => set({ requiredApproverTeams: v })}
          />
          <Checkbox
            id={`${idPrefix}-saved-group-reset-review-on-change`}
            label="Reset review on changes"
            description="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
            value={!!value.resetReviewOnChange}
            setValue={(v) => set({ resetReviewOnChange: v })}
          />
          <Checkbox
            id={`${idPrefix}-saved-group-block-self-approval`}
            label="Block contributors from self-approving"
            description="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
            value={!!value.blockSelfApproval}
            setValue={(v) => set({ blockSelfApproval: v })}
          />
          <Checkbox
            id={`${idPrefix}-saved-group-autopublish-on-approval`}
            label="Allow approve & publish in one step"
            description="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a Saved Group change together."
            value={!!value.autopublishOnApproval}
            setValue={(v) => set({ autopublishOnApproval: v })}
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
              <Checkbox
                id={`${idPrefix}-saved-group-metadata-review`}
                label="Metadata changes (description, owner, project, tags, etc.)"
                value={value.requireMetadataReview !== false}
                setValue={(v) => set({ requireMetadataReview: v })}
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
  savedGroupRule,
  onSavedGroupChange,
  savedGroupDescription,
}: {
  idPrefix: string;
  flagRule: RequireReview;
  onFlagChange: (next: RequireReview) => void;
  savedGroupRule: ApprovalFlowConfiguration;
  onSavedGroupChange: (next: ApprovalFlowConfiguration) => void;
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
        />
      </Box>
    </>
  );
}
