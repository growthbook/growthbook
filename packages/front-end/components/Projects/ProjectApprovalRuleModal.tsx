import { useForm } from "react-hook-form";
import { RequireReview } from "shared/types/organization";
import { getReviewSetting } from "shared/util";
import NextLink from "next/link";
import { Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

type FormValues = {
  requireReviewOn: boolean;
  environments: string[];
  requiredApproverTeams: string[];
};

const NEW_RULE_DEFAULTS: RequireReview = {
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments: [],
  projects: [],
};

export default function ProjectApprovalRuleModal({
  project,
  projectName,
  close,
  onSuccess,
}: {
  project: string;
  projectName: string;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const { settings, teams } = useUser();
  const { apiCall } = useAuth();
  const environments = useEnvironments();

  const rules = Array.isArray(settings.requireReviews)
    ? settings.requireReviews
    : [];
  // Only a rule naming this project alone: editing a rule shared with other
  // projects here would change governance for projects not on screen.
  const ownIndex = rules.findIndex(
    (r) => r.projects.length === 1 && r.projects[0] === project,
  );
  const own = ownIndex >= 0 ? rules[ownIndex] : undefined;
  const inherited = own
    ? undefined
    : (getReviewSetting(rules, { project }) ?? NEW_RULE_DEFAULTS);
  const base = own ?? inherited ?? NEW_RULE_DEFAULTS;

  const form = useForm<FormValues>({
    defaultValues: {
      requireReviewOn: !!base.requireReviewOn,
      environments: base.environments ?? [],
      requiredApproverTeams: base.requiredApproverTeams ?? [],
    },
  });

  const saveRules = async (next: RequireReview[]) => {
    await apiCall("/organization", {
      method: "PUT",
      body: JSON.stringify({ settings: { requireReviews: next } }),
    });
    await onSuccess();
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={`Approval Requirements for ${projectName}`}
      subheader="Governs Feature Flags, Configs, and Constants in this project."
      secondaryAction={
        own ? (
          <Button
            variant="ghost"
            color="red"
            onClick={async () => {
              await saveRules(rules.filter((_, i) => i !== ownIndex));
              close();
            }}
          >
            Remove override
          </Button>
        ) : undefined
      }
      submit={form.handleSubmit(async (value) => {
        const rule: RequireReview = {
          ...base,
          projects: [project],
          requireReviewOn: value.requireReviewOn,
          environments: value.environments,
          requiredApproverTeams: value.requiredApproverTeams,
        };
        await saveRules(
          ownIndex >= 0
            ? rules.map((r, i) => (i === ownIndex ? rule : r))
            : [...rules, rule],
        );
      })}
    >
      {inherited ? (
        <Callout status="info" mb="4">
          This project follows the organization default. Saving creates an
          override that applies to {projectName} only.{" "}
          <NextLink href="/settings#approval-flow">
            View organization defaults
          </NextLink>
        </Callout>
      ) : null}
      <Flex direction="column" gap="4">
        <Checkbox
          id="project-require-reviews"
          label="Require approval to publish changes"
          value={form.watch("requireReviewOn")}
          setValue={(v) => form.setValue("requireReviewOn", v)}
        />
        {form.watch("requireReviewOn") ? (
          <>
            <MultiSelectField
              legacyHeight
              id="project-review-environments"
              label="Specific environments"
              labelClassName="font-weight-semibold"
              containerClassName="mb-0"
              value={form.watch("environments")}
              onChange={(v) => form.setValue("environments", v)}
              options={environments.map((e) => ({ value: e.id, label: e.id }))}
              placeholder="All environments (leave blank to gate all)"
            />
            <MultiSelectField
              legacyHeight
              id="project-required-approver-teams"
              label="Required approver teams"
              labelClassName="font-weight-semibold"
              containerClassName="mb-0"
              value={form.watch("requiredApproverTeams")}
              onChange={(v) => form.setValue("requiredApproverTeams", v)}
              options={(teams ?? []).map((t) => ({
                value: t.id,
                label: t.name,
              }))}
              placeholder="Anyone who can review (leave blank)"
              helpText="A draft cannot publish until someone from one of these teams approves it. Anyone eligible can still approve alongside them."
            />
          </>
        ) : null}
      </Flex>
    </ModalStandard>
  );
}
