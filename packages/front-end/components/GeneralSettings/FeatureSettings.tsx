import { isEqual } from "lodash";
import React, { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FaExclamationCircle } from "react-icons/fa";
import { Box, Flex } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import { useEnvironments, FEATURE_RULES_ALL_ENVS } from "@/services/features";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { GBInfo } from "@/components/Icons";
import { SettingsField, SettingsGroup } from "./SettingsGroup";
import styles from "./SettingsSection.module.scss";

export default function FeatureSettings() {
  const [codeRefsBranchesToFilterStr, setCodeRefsBranchesToFilterStr] =
    useState<string>("");

  const { hasCommercialFeature } = useUser();
  const environments = useEnvironments();
  const form = useFormContext();

  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );

  const hasCodeReferencesFeature = hasCommercialFeature("code-references");

  useEffect(() => {
    if (!form) return;

    const branches = codeRefsBranchesToFilterStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (isEqual(branches, form.watch("codeRefsBranchesToFilter"))) return;

    form.setValue(
      "codeRefsBranchesToFilter",
      codeRefsBranchesToFilterStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [form, codeRefsBranchesToFilterStr]);

  return (
    <>
      <SettingsGroup
        id="ff-keys"
        title="Keys & naming"
        description="Naming rules shown when creating a flag, and hashing for secure attributes."
        keywords="feature key example regex naming validation salt secure attributes hash"
      >
        <SettingsField
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
                  <p className="mb-0 text-warning-orange small">
                    <FaExclamationCircle /> When using an insecure environment,
                    do not rely exclusively on hashing as a means of securing
                    highly sensitive data. Hashing is an obfuscation technique
                    that makes it very difficult, but not impossible, to extract
                    sensitive data.
                  </p>
                </>
              }
            >
              Salt for secure attributes <GBInfo />
            </PremiumTooltip>
          }
          help="Used to hash secure attribute values before they're sent to SDKs."
        >
          <Field
            size="legacy"
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
            size="legacy"
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
            size="legacy"
            id="featureRegexValidator"
            containerClassName="mb-0"
            {...form.register("featureRegexValidator")}
            placeholder=""
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="ff-defaults"
        title="Defaults for new flags"
        description="Applied when someone creates a flag or rule."
        keywords="require project environment rules json sparse patch preferred environment"
      >
        {hasCommercialFeature("require-project-for-features-setting") && (
          <Checkbox
            id="toggle-requireProjectForFeatures"
            label="Require a Project for new flags"
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
          description="New rules on object-valued JSON flags open in sparse mode, where you edit only the keys that differ from the default."
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
          description="New base Configs permit child Configs and Feature Flag rules to add keys beyond the declared schema."
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
          description="New Configs enable the experiment guard: publishing a change served to a running experiment soft-blocks until acknowledged."
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
          description={`Re-validate flag and Config values on publish and block the publish if they don't match. When off, errors show as a warning that can be bypassed. API edits are always validated unless the request body passes "skipSchemaValidation": true.`}
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
            description="A soft limit to reduce clutter. Users are warned and asked to confirm before creating drafts past the cap. REST API calls can override it and automated processes are exempt."
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
        title="Code references"
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
                <Flex
                  justify="between"
                  align="start"
                  gap="3"
                  className={styles.setupCard}
                >
                  <Box>
                    <Text as="p" weight="semibold" mb="1">
                      For GitHub users
                    </Text>
                    <Text as="p" size="sm" color="text-mid">
                      Use our all-in-one GitHub Action to integrate GrowthBook
                      into your CI workflow.
                    </Text>
                  </Box>
                  <a
                    href="https://github.com/marketplace/actions/growthbook-code-references"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button variant="ghost">Setup</Button>
                  </a>
                </Flex>
                <Flex
                  justify="between"
                  align="start"
                  gap="3"
                  className={styles.setupCard}
                >
                  <Box>
                    <Text as="p" weight="semibold" mb="1">
                      For non-GitHub users
                    </Text>
                    <Text as="p" size="sm" color="text-mid">
                      Use our CLI utility that takes in a list of feature keys
                      and scans your codebase to provide a JSON output of code
                      references, which you can supply to our code references{" "}
                      <a
                        href="https://docs.growthbook.io/api#tag/code-references"
                        target="_blank"
                        rel="noreferrer"
                      >
                        REST API endpoint
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
                      CLI Utility
                    </a>{" "}
                    |{" "}
                    <a
                      href="https://hub.docker.com/r/growthbook/gb-find-code-refs"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Docker Image
                    </a>
                  </Text>
                </Flex>
              </Flex>
            </SettingsField>

            <SettingsField
              label="Branches"
              help="Only show references from these branches. Comma-separated."
            >
              <Field
                size="legacy"
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
              label="Code host"
              help="Used to link directly to the source."
            >
              <Box width="320px" maxWidth="100%">
                <SelectField
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
