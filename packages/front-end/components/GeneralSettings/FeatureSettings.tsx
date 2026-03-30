import { isEqual } from "lodash";
import React, { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { FaExclamationCircle } from "react-icons/fa";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import { useEnvironments } from "@/services/features";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import { GBInfo } from "@/components/Icons";
import Frame from "@/ui/Frame";
import Callout from "@/ui/Callout";

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
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="4" as="h4">
            Feature Settings
          </Heading>
        </Box>

        <Flex align="start" direction="column" flexGrow="1" pt="6">
          <Box mb="5" width="100%">
            <Callout status="info">
              Approval flow settings have moved to the{" "}
              <a href="#approval-flow">Approval Flows tab</a>.
            </Callout>
          </Box>
          <Box mb="4" width="100%">
            <Field
              label={
                <PremiumTooltip
                  commercialFeature="hash-secure-attributes"
                  body={
                    <>
                      <p>
                        Feature targeting conditions referencing{" "}
                        <code>secureString</code> attributes will be anonymized
                        via SHA-256 hashing. When evaluating feature flags in a
                        public or insecure environment (such as a browser),
                        hashing provides an additional layer of security through
                        obfuscation. This allows you to target users based on
                        sensitive attributes.
                      </p>
                      <p>
                        You must enable this feature in your SDK Connection for
                        it to take effect.
                      </p>
                      <p>
                        You may add a cryptographic salt string (a random string
                        of your choosing) to the hashing algorithm, which helps
                        defend against hash lookup vulnerabilities.
                      </p>
                      <p className="mb-0 text-warning-orange small">
                        <FaExclamationCircle /> When using an insecure
                        environment, do not rely exclusively on hashing as a
                        means of securing highly sensitive data. Hashing is an
                        obfuscation technique that makes it very difficult, but
                        not impossible, to extract sensitive data.
                      </p>
                    </>
                  }
                >
                  <Text size="3" className="font-weight-semibold">
                    Salt string for secure attributes
                  </Text>{" "}
                  <GBInfo />
                </PremiumTooltip>
              }
              disabled={!hasSecureAttributesFeature}
              type="string"
              {...form.register("secureAttributeSalt")}
            />
          </Box>
          <Box mb="6" width="100%">
            <Text as="label" htmlFor="featureKeyExample" mb="2">
              <Text size="3" className="font-weight-semibold">
                Feature Key Example (Optional)
              </Text>
            </Text>
            <Text as="p" mb="2" size="2">
              When creating a new feature, this example will be shown. Only
              letters, numbers, and the characters _, -, ., :, and | allowed. No
              spaces.
            </Text>
            <Field
              id="featureKeyExample"
              {...form.register("featureKeyExample")}
              placeholder="my-feature"
            />
          </Box>
          <Box mb="6" width="100%">
            <Text
              as="label"
              htmlFor="featureRegexValidator"
              size="3"
              className="font-weight-semibold"
            >
              Feature Key Regex Validator (Optional)
            </Text>
            <Text as="p" mb="2" size="2">
              When using the create feature modal, this will validate the
              feature key against this regex. This will not block API feature
              creation, and is used to enforce naming conventions at some
              companies.
            </Text>
            <Field
              id="featureRegexValidator"
              {...form.register("featureRegexValidator")}
              placeholder=""
            />
          </Box>

          {/* Require project for features */}
          {hasCommercialFeature("require-project-for-features-setting") && (
            <Box mb="6" width="100%">
              <Checkbox
                id="toggle-requireProjectForFeatures"
                label="Require Project for all new Features"
                description="If enabled, users will be required to select a project when creating a feature flag."
                value={!!form.watch("requireProjectForFeatures")}
                setValue={(value) =>
                  form.setValue("requireProjectForFeatures", value, {
                    shouldDirty: true,
                  })
                }
              />
            </Box>
          )}

          <Box mb="6" width="100%">
            <Checkbox
              id="toggle-defaultFeatureRulesInAllEnvs"
              label="Create rules in all environments by default"
              description="If enabled, new feature rules will be created in all environments by default."
              value={!!form.watch("defaultFeatureRulesInAllEnvs")}
              setValue={(value) =>
                form.setValue("defaultFeatureRulesInAllEnvs", value, {
                  shouldDirty: true,
                })
              }
            />
          </Box>

          <Box mb="5">
            <SelectField
              id="preferredEnvironment"
              label="Preferred environment for feature pages:"
              labelClassName="font-weight-semibold"
              value={form.watch("preferredEnvironment") || ""}
              isClearable
              options={[
                {
                  label: "Remember previous environment",
                  value: "",
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

          {/* Code References */}
          <Box mb="6" width="100%">
            <Box className="appbox p-3">
              <Heading size="3" className="font-weight-semibold" mb="4">
                Code References
              </Heading>
              <Checkbox
                id="toggle-codeReferences"
                label="Enable code references"
                description="Displays code references for feature flags in the GrowthBook UI"
                value={!!form.watch("codeReferencesEnabled")}
                setValue={(value) =>
                  form.setValue("codeReferencesEnabled", value)
                }
                disabled={!hasCodeReferencesFeature}
              />

              {form.watch("codeReferencesEnabled") && (
                <Box ml="5" mt="2">
                  <Box mb="3">
                    <Text as="p" mb="3" className="font-weight-semibold">
                      Code References Setup
                    </Text>
                    <Box className="appbox" p="4" mb="3">
                      <Flex justify="between">
                        <Box>
                          <Heading
                            as="h4"
                            className="font-weight-semibold"
                            size="3"
                            mb="3"
                          >
                            For GitHub Users
                          </Heading>
                          <Text as="p" mb="0">
                            Use our all-in-one GitHub Action to integrate
                            GrowthBook into your CI workflow.
                          </Text>
                        </Box>
                        <div className="col-sm-3 text-right">
                          <a
                            href="https://github.com/marketplace/actions/growthbook-code-references"
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button variant="ghost">Setup</Button>
                          </a>
                        </div>
                      </Flex>
                    </Box>

                    <Box className="appbox" p="4" mb="3">
                      <Flex justify="between">
                        <Box>
                          <Heading
                            as="h4"
                            className="font-weight-semibold"
                            size="3"
                            mb="3"
                          >
                            For Non-GitHub Users
                          </Heading>
                          <Text as="p" mb="0">
                            Use our CLI utility that takes in a list of feature
                            keys and scans your codebase to provide a JSON
                            output of code references, which you can supply to
                            our code references{" "}
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
                        <Box>
                          <Text wrap="nowrap">
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
                        </Box>
                      </Flex>
                    </Box>
                  </Box>
                  <Box mb="5">
                    <Field
                      label="Only show code refs from the following branches (comma-separated, optional):"
                      type="text"
                      placeholder="main, qa, dev"
                      value={codeRefsBranchesToFilterStr}
                      onChange={(v) =>
                        setCodeRefsBranchesToFilterStr(v.currentTarget.value)
                      }
                    />
                  </Box>

                  <Box mb="5">
                    <SelectField
                      label="Platform (to allow direct linking, optional):"
                      labelClassName="font-weight-semibold"
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
                </Box>
              )}
            </Box>
          </Box>
        </Flex>
      </Flex>
    </Frame>
  );
}
