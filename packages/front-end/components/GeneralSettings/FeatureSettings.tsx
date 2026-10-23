import React from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import { useEnvironments, FEATURE_RULES_ALL_ENVS } from "@/services/features";
import Checkbox from "@/ui/Checkbox";
import LinkButton from "@/ui/LinkButton";
import Frame from "@/ui/Frame";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { GBInfo } from "@/components/Icons";
import { useSettingsForm } from "./SettingsFormProvider";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function FeatureSettings() {
  const { codeRefsBranchesToFilterStr, setCodeRefsBranchesToFilterStr } =
    useSettingsForm();

  const { hasCommercialFeature } = useUser();
  const environments = useEnvironments();
  const form = useFormContext();

  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );

  const hasCodeReferencesFeature = hasCommercialFeature("code-references");

  return (
    <>
      <SettingsGroup
        id="ff-keys"
        title="Keys & Naming"
        description="Naming rules shown when creating a flag."
        keywords="feature key example regex naming validation salt secure attributes hash"
      >
        <SettingsField
          htmlFor="settings-secureAttributeSalt"
          label={
            <PremiumTooltip
              commercialFeature="hash-secure-attributes"
              body={
                <>
                  <p>
                    Feature targeting conditions referencing{" "}
                    <code>secureString</code> attributes will be anonymized via
                    SHA-256 hashing. When evaluating Feature Flags in a public
                    or insecure environment (such as a browser), hashing
                    provides an additional layer of security through
                    obfuscation. This allows you to target users based on
                    sensitive attributes.
                  </p>
                  <p>
                    You must enable this feature in your SDK Connection for it
                    to take effect.
                  </p>
                  <p>
                    You may add a cryptographic salt string (a random string of
                    your choosing) to the hashing algorithm, which helps defend
                    against hash lookup vulnerabilities.
                  </p>
                  <HelperText status="warning">
                    When using an insecure environment, do not rely exclusively
                    on hashing as a means of securing highly sensitive data.
                    Hashing is an obfuscation technique that makes it very
                    difficult, but not impossible, to extract sensitive data.
                  </HelperText>
                </>
              }
            >
              Salt for secure attributes <GBInfo />
            </PremiumTooltip>
          }
          help="Used to hash secure attribute values before they're sent to SDKs."
        >
          <Field
            id="settings-secureAttributeSalt"
            size="md"
            containerClassName="mb-0"
            disabled={!hasSecureAttributesFeature}
            type="string"
            {...form.register("secureAttributeSalt")}
          />
        </SettingsField>

        <SettingsField
          htmlFor="featureKeyExample"
          label="Feature key example"
          help="Shown when creating a flag. Letters, numbers, and _ - . : | only. No spaces."
        >
          <Field
            size="md"
            id="featureKeyExample"
            containerClassName="mb-0"
            {...form.register("featureKeyExample")}
            placeholder="my-feature"
          />
        </SettingsField>

        <SettingsField
          htmlFor="featureRegexValidator"
          label="Feature key format (regex)"
          help="Checked when creating a flag in the app. Doesn't block flags created through the API."
        >
          <Field
            size="md"
            id="featureRegexValidator"
            containerClassName="mb-0"
            {...form.register("featureRegexValidator")}
            placeholder=""
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="ff-defaults"
        title="Defaults for New Feature Flags"
        description="Applied when someone creates a flag or rule."
        keywords="require project environment rules json sparse patch preferred environment"
      >
        {hasCommercialFeature("require-project-for-features-setting") && (
          <Checkbox
            id="toggle-requireProjectForFeatures"
            label="Require a Project for new Feature Flags"
            description="Users must pick a Project when creating a flag."
            value={!!form.watch("requireProjectForFeatures")}
            setValue={(value) =>
              form.setValue("requireProjectForFeatures", value, {
                shouldDirty: true,
              })
            }
          />
        )}

        <Checkbox
          id="toggle-requireScopedFeatureRules"
          label="Require rules to target specific environments or Projects"
          description="Rules for All Environments and All Projects need an extra confirmation."
          value={!!form.watch("requireScopedFeatureRules")}
          setValue={(value) =>
            form.setValue("requireScopedFeatureRules", value, {
              shouldDirty: true,
            })
          }
        />

        <Checkbox
          id="toggle-sparseJSONRulesByDefault"
          label="Default JSON rules to sparse patch mode"
          description="New rules on JSON flags only edit the keys that differ from the default value."
          value={!!form.watch("sparseJSONRulesByDefault")}
          setValue={(value) =>
            form.setValue("sparseJSONRulesByDefault", value, {
              shouldDirty: true,
            })
          }
        />

        <SettingsField
          htmlFor="preferredEnvironment"
          label="Environment shown on flag pages"
        >
          <Box width="320px" maxWidth="100%">
            <SelectField
              id="preferredEnvironment"
              value={form.watch("preferredEnvironment") || ""}
              isClearable
              options={[
                {
                  label: "Remember previous environment",
                  value: "",
                },
                {
                  label: "All Environments",
                  value: FEATURE_RULES_ALL_ENVS,
                },
                ...environments.map((env) => ({
                  label: env.id,
                  value: env.id,
                })),
              ]}
              formatOptionLabel={(option) => {
                if (option.value === "") {
                  return <em>{option.label}</em>;
                }
                return option.label;
              }}
              onChange={(v: string) => form.setValue("preferredEnvironment", v)}
              sort={false}
            />
          </Box>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="ff-configs"
        title="Configs"
        description="Defaults for new base Configs. Each Config can override these."
        keywords="configs schema extend experiment guard"
      >
        <Checkbox
          id="toggle-configsExtensibleByDefault"
          label="Allow Configs to be extended"
          description="Child Configs and flag rules can add keys beyond the declared schema."
          value={!!form.watch("configsExtensibleByDefault")}
          setValue={(value) =>
            form.setValue("configsExtensibleByDefault", value, {
              shouldDirty: true,
            })
          }
        />
        <Checkbox
          id="toggle-configExperimentGuardDefault"
          label="Guard Configs used by running experiments"
          description="Publishing a change served to a running experiment is blocked until someone acknowledges it."
          value={!!form.watch("configExperimentGuardDefault")}
          setValue={(value) =>
            form.setValue("configExperimentGuardDefault", value, {
              shouldDirty: true,
            })
          }
        />
      </SettingsGroup>

      <SettingsGroup
        id="ff-publishing"
        title="Publishing"
        description="Checks applied when a revision is published."
        keywords="publish json schema validation drafts cap revision limit"
      >
        <Checkbox
          id="toggle-blockPublishOnSchemaError"
          label="Block publishing on JSON schema errors"
          description="Re-validate flag and Config values on publish. When off, errors show as a warning that can be bypassed. API edits are always validated unless skipSchemaValidation is true."
          value={form.watch("blockPublishOnSchemaError") ?? true}
          setValue={(value) =>
            form.setValue("blockPublishOnSchemaError", value, {
              shouldDirty: true,
            })
          }
        />
        <Box>
          {/* TODO(UI): move to a neutral org-level "Revisions" section once
              saved groups & others enforce this cap (it's not feature-only). */}
          <Checkbox
            id="toggle-maxConcurrentDrafts"
            label="Cap drafts per flag"
            description="Warn and ask for confirmation before creating drafts past the cap. API calls and automated processes are exempt."
            value={(form.watch("maxConcurrentDrafts") ?? 0) !== 0}
            setValue={(value) =>
              form.setValue("maxConcurrentDrafts", value ? 3 : 0, {
                shouldDirty: true,
              })
            }
          />
          {(form.watch("maxConcurrentDrafts") ?? 0) !== 0 && (
            <Box ml="5" mt="2" width="150px">
              <Field
                type="number"
                append="drafts"
                step="1"
                min="1"
                containerClassName="mb-0"
                {...form.register("maxConcurrentDrafts", {
                  valueAsNumber: true,
                })}
              />
            </Box>
          )}
        </Box>
      </SettingsGroup>

      <SettingsGroup
        id="configure-code-refs"
        title="Code References"
        description="Show where each flag is used in your codebase."
        keywords="code references github gitlab bitbucket branches ci action cli"
      >
        <Checkbox
          id="toggle-codeReferences"
          label="Enable code references"
          description="Show code references on flag pages."
          value={!!form.watch("codeReferencesEnabled")}
          setValue={(value) => form.setValue("codeReferencesEnabled", value)}
          disabled={!hasCodeReferencesFeature}
        />

        {form.watch("codeReferencesEnabled") && (
          <>
            <SettingsField label="Setup">
              <Flex direction="column" gap="2">
                <Frame asChild mb="0" p="3">
                  <Flex justify="between" align="start" gap="3">
                    <Box>
                      <Text as="p" weight="semibold" mb="1">
                        GitHub
                      </Text>
                      <Text as="p" size="sm" color="text-mid">
                        Add the GitHub Action to your CI workflow.
                      </Text>
                    </Box>
                    <LinkButton
                      variant="ghost"
                      href="https://github.com/marketplace/actions/growthbook-code-references"
                      external
                    >
                      Set up
                    </LinkButton>
                  </Flex>
                </Frame>
                <Frame asChild mb="0" p="3">
                  <Flex justify="between" align="start" gap="3">
                    <Box>
                      <Text as="p" weight="semibold" mb="1">
                        Other code hosts
                      </Text>
                      <Text as="p" size="sm" color="text-mid">
                        Run the CLI to scan your codebase and send the results
                        to the{" "}
                        <a
                          href="https://docs.growthbook.io/api#tag/code-references"
                          target="_blank"
                          rel="noreferrer"
                        >
                          code references REST endpoint
                        </a>
                        .
                      </Text>
                    </Box>
                    <Text whiteSpace="nowrap">
                      <a
                        href="https://github.com/growthbook/gb-find-code-refs"
                        target="_blank"
                        rel="noreferrer"
                      >
                        CLI utility
                      </a>{" "}
                      |{" "}
                      <a
                        href="https://hub.docker.com/r/growthbook/gb-find-code-refs"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Docker image
                      </a>
                    </Text>
                  </Flex>
                </Frame>
              </Flex>
            </SettingsField>

            <SettingsField
              htmlFor="settings-branches"
              label="Branches"
              help="Only show references from these branches. Comma-separated."
            >
              <Field
                id="settings-branches"
                size="md"
                type="text"
                containerClassName="mb-0"
                placeholder="main, qa, dev"
                value={codeRefsBranchesToFilterStr}
                onChange={(v) =>
                  setCodeRefsBranchesToFilterStr(v.currentTarget.value)
                }
              />
            </SettingsField>

            <SettingsField
              htmlFor="settings-codeRefsPlatformUrl"
              label="Code host"
              help="Used to link directly to the source."
            >
              <Box width="320px" maxWidth="100%">
                <SelectField
                  id="settings-codeRefsPlatformUrl"
                  containerClassName="mb-0"
                  value={form.watch("codeRefsPlatformUrl") || ""}
                  isClearable
                  options={[
                    {
                      label: "GitHub",
                      value: "https://github.com",
                    },
                    {
                      label: "GitLab",
                      value: "https://gitlab.com",
                    },
                  ]}
                  onChange={(v: string) =>
                    form.setValue("codeRefsPlatformUrl", v || "")
                  }
                />
              </Box>
            </SettingsField>
          </>
        )}
      </SettingsGroup>
    </>
  );
}
