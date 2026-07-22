import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/ui/MultiSelectField";
import Link from "@/ui/Link";

export default function ApprovalFlowSettings() {
  const form = useFormContext<OrganizationSettingsWithMetricDefaults>();
  const { hasCommercialFeature } = useUser();
  const environments = useEnvironments();
  const { projects } = useDefinitions();

  const hasRequireApprovals = hasCommercialFeature("require-approvals");

  const rawRequireReviews = form.watch("requireReviews");
  const featureRequireReviews = Array.isArray(rawRequireReviews)
    ? rawRequireReviews
    : [];

  const [showProjectScope, setShowProjectScope] = useState<
    Record<number, boolean>
  >(() => {
    const raw = form.getValues("requireReviews");
    const rules: { projects?: string[]; environments?: string[] }[] =
      Array.isArray(raw) ? raw : [];
    return Object.fromEntries(
      rules.map((r, i) => [i, !!(r.projects?.length ?? 0)]),
    );
  });

  const [showEnvScope, setShowEnvScope] = useState<Record<number, boolean>>(
    () => {
      const raw = form.getValues("requireReviews");
      const rules: { environments?: string[] }[] = Array.isArray(raw)
        ? raw
        : [];
      return Object.fromEntries(
        rules.map((r, i) => [i, !!(r.environments?.length ?? 0)]),
      );
    },
  );

  // Auto-expand scope views when form values are loaded asynchronously
  // (the form initializes with defaults before settings load via useEffect+reset).
  const requireReviewsWatched = form.watch("requireReviews");
  useEffect(() => {
    if (!Array.isArray(requireReviewsWatched)) return;
    setShowEnvScope((prev) => {
      const next = { ...prev };
      requireReviewsWatched.forEach((r, i) => {
        if ((r.environments?.length ?? 0) > 0) next[i] = true;
      });
      return next;
    });
    setShowProjectScope((prev) => {
      const next = { ...prev };
      requireReviewsWatched.forEach((r, i) => {
        if ((r.projects?.length ?? 0) > 0) next[i] = true;
      });
      return next;
    });
  }, [requireReviewsWatched]);

  // Org-wide targeting review governance. The UI edits the all-projects default
  // rule; any project-specific override rules (API-only for now) are preserved.
  const targetingReviewRules = form.watch("targetingReviewMode") || [];
  const orgWideTargetingRule = targetingReviewRules.find(
    (r) => (r.projects?.length ?? 0) === 0,
  );
  const targetingStrict = orgWideTargetingRule
    ? orgWideTargetingRule.mode === "strict"
    : true;
  const setTargetingMode = (strict: boolean) => {
    const mode: "strict" | "loose" = strict ? "strict" : "loose";
    const perProject = targetingReviewRules.filter(
      (r) => (r.projects?.length ?? 0) > 0,
    );
    form.setValue("targetingReviewMode", [
      ...perProject,
      { projects: [], mode },
    ]);
  };

  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="medium" as="h4">
            Approval Flows
          </Heading>
        </Box>
      </Flex>

      <Flex align="start" direction="column" gap="4" mt="7">
        <Box width="100%">
          <Frame p="3" mb="0">
            <Heading as="h4" size="small" weight="semibold" mb="4">
              Features
            </Heading>

            <Text as="p" size="medium" mb="4" color="text-low">
              All changes to features are tracked as revisions. Requiring
              approvals adds a review step before any change goes live. Kill
              switch changes always prompt a confirmation regardless of approval
              settings.
            </Text>

            {hasRequireApprovals && (
              <>
                {featureRequireReviews.map((_, i) => (
                  <Box key={`approval-flow-${i}`}>
                    <Checkbox
                      id={`toggle-require-reviews-${i}`}
                      label="Require approval to publish changes"
                      value={
                        !!form.watch(`requireReviews.${i}.requireReviewOn`)
                      }
                      setValue={(value) =>
                        form.setValue(
                          `requireReviews.${i}.requireReviewOn`,
                          value,
                        )
                      }
                    />
                    {!!form.watch(`requireReviews.${i}.requireReviewOn`) && (
                      <Flex direction="column" gap="3" mt="2" ml="5">
                        <Flex direction="column" gap="3" mb="3">
                          {showProjectScope[i] ? (
                            <MultiSelectField
                              size="legacy"
                              id={`projects-${i}`}
                              label="Projects"
                              labelClassName="font-weight-semibold"
                              containerClassName="mb-0"
                              value={
                                form.watch(`requireReviews.${i}.projects`) || []
                              }
                              onChange={(v) =>
                                form.setValue(`requireReviews.${i}.projects`, v)
                              }
                              options={projects.map((e) => ({
                                value: e.id,
                                label: e.name,
                              }))}
                              placeholder="All Projects"
                            />
                          ) : (
                            <Link
                              onClick={() =>
                                setShowProjectScope((prev) => ({
                                  ...prev,
                                  [i]: true,
                                }))
                              }
                            >
                              <PiPlus /> For specific projects
                            </Link>
                          )}
                          {showEnvScope[i] ? (
                            <MultiSelectField
                              size="legacy"
                              id={`environments-${i}`}
                              label="Specific environments"
                              labelClassName="font-weight-semibold"
                              containerClassName="mb-0"
                              value={
                                form.watch(
                                  `requireReviews.${i}.environments`,
                                ) || []
                              }
                              onChange={(v) =>
                                form.setValue(
                                  `requireReviews.${i}.environments`,
                                  v,
                                )
                              }
                              options={environments.map((e) => ({
                                value: e.id,
                                label: e.id,
                              }))}
                              placeholder="All environments (leave blank to gate all)"
                            />
                          ) : (
                            <Link
                              onClick={() =>
                                setShowEnvScope((prev) => ({
                                  ...prev,
                                  [i]: true,
                                }))
                              }
                            >
                              <PiPlus /> For specific environments
                            </Link>
                          )}
                        </Flex>
                        <Checkbox
                          id={`toggle-reset-review-on-change-${i}`}
                          label="Reset review on changes"
                          description="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
                          value={
                            !!form.watch(
                              `requireReviews.${i}.resetReviewOnChange`,
                            )
                          }
                          setValue={(v) =>
                            form.setValue(
                              `requireReviews.${i}.resetReviewOnChange`,
                              v,
                            )
                          }
                        />
                        <Checkbox
                          id={`toggle-block-self-approval-${i}`}
                          label="Block contributors from self-approving"
                          description="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
                          value={
                            !!form.watch(
                              `requireReviews.${i}.blockSelfApproval`,
                            )
                          }
                          setValue={(v) =>
                            form.setValue(
                              `requireReviews.${i}.blockSelfApproval`,
                              v,
                            )
                          }
                        />
                        <Checkbox
                          id={`toggle-autopublish-on-approval-${i}`}
                          label="Allow approve & publish in one step"
                          description="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a draft together."
                          value={
                            !!form.watch(
                              `requireReviews.${i}.autopublishOnApproval`,
                            )
                          }
                          setValue={(v) =>
                            form.setValue(
                              `requireReviews.${i}.autopublishOnApproval`,
                              v,
                            )
                          }
                        />
                        <Box mt="2">
                          <Text
                            as="label"
                            size="medium"
                            weight="semibold"
                            mb="2"
                          >
                            Require approval for
                          </Text>
                          <Flex direction="column" gap="2" align="start">
                            <Checkbox
                              id={`toggle-rules-values-${i}`}
                              label="Rules, values, and prerequisites"
                              value={true}
                              disabled={true}
                              setValue={() => undefined}
                            />
                            <Checkbox
                              id={`toggle-env-review-${i}`}
                              label="Enabled environment changes (kill switches)"
                              value={
                                form.watch(
                                  `requireReviews.${i}.featureRequireEnvironmentReview`,
                                ) !== false
                              }
                              setValue={(v) =>
                                form.setValue(
                                  `requireReviews.${i}.featureRequireEnvironmentReview`,
                                  v,
                                )
                              }
                            />
                            <Checkbox
                              id={`toggle-metadata-review-${i}`}
                              label="Metadata changes (description, owner, project, tags, etc.)"
                              value={
                                form.watch(
                                  `requireReviews.${i}.featureRequireMetadataReview`,
                                ) !== false
                              }
                              setValue={(v) =>
                                form.setValue(
                                  `requireReviews.${i}.featureRequireMetadataReview`,
                                  v,
                                )
                              }
                            />
                          </Flex>
                        </Box>
                        {/* REST API bypass — global, shown after the last rule's options */}
                        {i === featureRequireReviews.length - 1 && (
                          <Box mt="2">
                            <Checkbox
                              id="toggle-restApiBypassesReviews"
                              label="REST API always bypasses approval requirements"
                              description="When enabled, all API calls bypass approval requirements. When disabled, API calls are blocked unless the caller's role grants bypassApprovalChecks on the Feature Flag's Project."
                              value={
                                form.watch("restApiBypassesReviews") !== false
                              }
                              setValue={(v) =>
                                form.setValue("restApiBypassesReviews", v)
                              }
                            />
                          </Box>
                        )}
                      </Flex>
                    )}
                  </Box>
                ))}
                <Box mt="4">
                  <Checkbox
                    id="toggle-targeting-review-mode"
                    label="Require review from secondary (targeting) projects"
                    description="When a feature or config is targeted in secondary projects, also apply those projects' approval requirements before publishing (strict). Disable to let only the primary project govern approvals (loose)."
                    value={targetingStrict}
                    setValue={setTargetingMode}
                  />
                </Box>
              </>
            )}
          </Frame>
        </Box>

        <Box width="100%">
          <Frame p="3" mb="0">
            <Heading as="h4" size="small" weight="semibold" mb="4">
              Saved Groups
            </Heading>

            <Text as="p" size="medium" mb="4" color="text-low">
              All changes to Saved Groups are tracked as revisions. Requiring
              approvals adds a review step before any change goes live.
            </Text>

            {hasRequireApprovals && (
              <>
                <Checkbox
                  id="toggle-require-approvals-saved-groups"
                  label="Require approval to modify Saved Groups"
                  description="When enabled, all changes to Saved Groups must be reviewed and approved by another person before going live."
                  value={!!form.watch("approvalFlows.savedGroups.0.required")}
                  setValue={(v) =>
                    form.setValue("approvalFlows.savedGroups.0.required", v)
                  }
                />
                {!!form.watch("approvalFlows.savedGroups.0.required") && (
                  <Flex direction="column" gap="3" mt="2" ml="5">
                    <Box mt="2">
                      <Text as="label" size="medium" weight="semibold" mb="2">
                        Require approval for
                      </Text>
                      <Flex direction="column" gap="2" align="start">
                        <Checkbox
                          id="toggle-saved-group-values-conditions"
                          label="Values and conditions"
                          value={true}
                          disabled={true}
                          setValue={() => undefined}
                        />
                        <Checkbox
                          id="toggle-saved-group-metadata-review"
                          label="Metadata changes (description, owner, project, tags, etc.)"
                          value={
                            form.watch(
                              `approvalFlows.savedGroups.0.requireMetadataReview`,
                            ) !== false
                          }
                          setValue={(v) =>
                            form.setValue(
                              `approvalFlows.savedGroups.0.requireMetadataReview`,
                              v,
                            )
                          }
                        />
                      </Flex>
                    </Box>
                    <Checkbox
                      id="toggle-saved-group-reset-review-on-change"
                      label="Reset review on changes"
                      description="If a draft is modified after being approved, the approval is revoked and a new review is required before publishing."
                      value={
                        !!form.watch(
                          `approvalFlows.savedGroups.0.resetReviewOnChange`,
                        )
                      }
                      setValue={(v) =>
                        form.setValue(
                          `approvalFlows.savedGroups.0.resetReviewOnChange`,
                          v,
                        )
                      }
                    />
                    <Checkbox
                      id="toggle-saved-group-block-self-approval"
                      label="Block contributors from self-approving"
                      description="Prevents anyone who edited a draft from approving it. Requires a separate reviewer."
                      value={
                        !!form.watch(
                          `approvalFlows.savedGroups.0.blockSelfApproval`,
                        )
                      }
                      setValue={(v) =>
                        form.setValue(
                          `approvalFlows.savedGroups.0.blockSelfApproval`,
                          v,
                        )
                      }
                    />
                    <Checkbox
                      id="toggle-saved-group-autopublish-on-approval"
                      label="Allow approve & publish in one step"
                      description="Adds an 'Approve & Publish' option so reviewers with publish access can approve and publish a Saved Group change together."
                      value={
                        !!form.watch(
                          `approvalFlows.savedGroups.0.autopublishOnApproval`,
                        )
                      }
                      setValue={(v) =>
                        form.setValue(
                          `approvalFlows.savedGroups.0.autopublishOnApproval`,
                          v,
                        )
                      }
                    />
                  </Flex>
                )}
              </>
            )}
          </Frame>
        </Box>

        {hasRequireApprovals && (
          <Box width="100%">
            <Frame p="3" mb="0">
              <Heading as="h4" size="small" weight="semibold" mb="4">
                Global
              </Heading>

              <Text as="p" size="medium" mb="4" color="text-low">
                These settings apply to every approval flow (Feature Flags and
                Saved Groups).
              </Text>

              <Flex direction="column" gap="3" align="start">
                <Checkbox
                  id="toggle-requireRebaseBeforePublish"
                  label="Require drafts to be rebased with live before publishing"
                  description="Drafts based on an older version — or with a stale approval — must be rebased with live before they can be published."
                  value={form.watch("requireRebaseBeforePublish") === true}
                  setValue={(v) =>
                    form.setValue("requireRebaseBeforePublish", v)
                  }
                />
                <Checkbox
                  id="toggle-reverts-bypass-approval"
                  label="Allow reverts without approval"
                  description="Anyone with publish permission can revert to a past revision and publish it immediately, even when approvals are required."
                  value={!!form.watch("revertsBypassApproval")}
                  setValue={(v) => form.setValue("revertsBypassApproval", v)}
                />
              </Flex>
            </Frame>
          </Box>
        )}
      </Flex>
    </Frame>
  );
}
