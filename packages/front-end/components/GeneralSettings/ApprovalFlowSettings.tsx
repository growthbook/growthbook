import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Checkbox from "@/ui/Checkbox";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";

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

  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="large" as="h2">
            <PremiumTooltip commercialFeature="require-approvals">
              Approval Flows
            </PremiumTooltip>
          </Heading>
        </Box>
      </Flex>

      <Flex align="start" direction="column" gap="5" mt="7">
        <Box width="100%">
          <Frame mb="0">
            <Heading size="medium" weight="semibold" as="h3" mb="4">
              Features
            </Heading>

            {featureRequireReviews.map?.((requireReviews, i) => (
              <Box key={`approval-flow-${i}`}>
                <Flex gap="3">
                  <Checkbox
                    id={`toggle-require-reviews-${i}`}
                    value={
                      !hasRequireApprovals
                        ? false
                        : !!form.watch(`requireReviews.${i}.requireReviewOn`)
                    }
                    setValue={(value) => {
                      form.setValue(
                        `requireReviews.${i}.requireReviewOn`,
                        value,
                      );
                    }}
                    disabled={!hasRequireApprovals}
                  />
                  <Box width="100%">
                    <Text as="label" htmlFor={`toggle-require-reviews-${i}`}>
                      Require approval to publish changes
                    </Text>

                    {hasRequireApprovals &&
                      !!form.watch(`requireReviews.${i}.requireReviewOn`) && (
                        <Box mt="4">
                          <Text
                            as="label"
                            htmlFor={`projects-${i}`}
                            weight="semibold"
                          >
                            Projects
                          </Text>
                          <MultiSelectField
                            id={`projects-${i}`}
                            value={
                              form.watch(`requireReviews.${i}.projects`) || []
                            }
                            onChange={(projects) => {
                              form.setValue(
                                `requireReviews.${i}.projects`,
                                projects,
                              );
                            }}
                            options={projects.map((e) => {
                              return {
                                value: e.id,
                                label: e.name,
                              };
                            })}
                            placeholder="All Projects"
                          />
                          <Text
                            as="label"
                            mt="5"
                            htmlFor={`environments-${i}`}
                            weight="semibold"
                          >
                            Environments
                          </Text>
                          <MultiSelectField
                            id={`environments-${i}`}
                            value={
                              form.watch(`requireReviews.${i}.environments`) ||
                              []
                            }
                            onChange={(environments) => {
                              form.setValue(
                                `requireReviews.${i}.environments`,
                                environments,
                              );
                            }}
                            options={environments.map((e) => {
                              return {
                                value: e.id,
                                label: e.id,
                              };
                            })}
                            placeholder="All Environments"
                          />
                          <Flex gap="3" mt="5">
                            <Checkbox
                              id={`toggle-reset-review-on-change-${i}`}
                              value={
                                !!form.watch(
                                  `requireReviews.${i}.resetReviewOnChange`,
                                )
                              }
                              setValue={(value) => {
                                form.setValue(
                                  `requireReviews.${i}.resetReviewOnChange`,
                                  value,
                                );
                              }}
                            />
                            <Text
                              as="label"
                              weight="semibold"
                              htmlFor={`toggle-reset-review-on-change-${i}`}
                            >
                              Reset review on changes
                            </Text>
                          </Flex>
                        </Box>
                      )}
                  </Box>
                </Flex>
              </Box>
            ))}
          </Frame>
        </Box>

        <Box width="100%">
          <Frame mb="0">
            <Heading size="medium" weight="semibold" as="h3" mb="4">
              Saved Groups
            </Heading>

            <Flex gap="3" align="start">
              <Checkbox
                id="toggle-require-approvals-saved-groups"
                value={!!form.watch("approvalFlows.savedGroups.required")}
                setValue={(v) =>
                  form.setValue("approvalFlows.savedGroups.required", v)
                }
                disabled={!hasRequireApprovals}
              />
              <Flex direction="column" gap="1">
                <Text
                  as="label"
                  htmlFor="toggle-require-approvals-saved-groups"
                >
                  Require approval to modify Saved Groups
                </Text>
                <Text as="p" size="small" color="text-low">
                  When enabled, all changes to Saved Groups must be reviewed and
                  approved by another person before going live.
                </Text>
              </Flex>
            </Flex>
          </Frame>
        </Box>
      </Flex>
    </Frame>
  );
}
