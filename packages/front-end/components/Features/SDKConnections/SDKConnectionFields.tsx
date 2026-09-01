import { SDKLanguage } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getLatestSDKVersion,
  getSDKCapabilityVersion,
  getSDKVersions,
  isSDKOutdated,
} from "shared/sdk-versioning";
import { useEffect } from "react";
import { Box, Flex, Grid } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/ui/MultiSelectField";
import Checkbox from "@/ui/Checkbox";
import RadioGroup from "@/ui/RadioGroup";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import {
  LanguageFilter,
  languageMapping,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import Callout from "@/ui/Callout";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { shouldShowPayloadSecurity } from "@/components/Features/SDKConnections/sdkConnectionRules";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";

export type DeliveryMode = "plain" | "ciphered" | "remote";

export type SDKConnectionFieldsValue = {
  name: string;
  languages: SDKLanguage[];
  sdkVersion?: string;
  environment: string;
  projects: string[];
  delivery: DeliveryMode;
  // Ciphered sub-options
  encryptPayload: boolean;
  includeExperimentNames: boolean;
  hashSecureAttributes: boolean;
  // Remote Eval sub-options
  includeRuleIds: boolean;
  includeVisualExperiments: boolean;
  includeRedirectExperiments: boolean;
};

/**
 * The connection fields shared by the create and edit modals, so the two can't
 * drift. Purely controlled: the modals own submission, the revision flow and
 * any capability sanitisation applied on save.
 */
export default function SDKConnectionFields({
  value,
  onChange,
  languageFilter,
  setLanguageFilter,
  languageError,
  disableScope = false,
  requireProjectSelection = false,
}: {
  value: SDKConnectionFieldsValue;
  onChange: (patch: Partial<SDKConnectionFieldsValue>) => void;
  languageFilter: LanguageFilter;
  setLanguageFilter: (f: LanguageFilter) => void;
  languageError?: string | null;
  /** Externally managed connections own their own scope. */
  disableScope?: boolean;
  requireProjectSelection?: boolean;
}) {
  const { projects } = useDefinitions();
  const environments = useEnvironments();
  const { hasCommercialFeature } = useUser();

  // Per-SDK gating lives here so create and edit cannot diverge. It mirrors
  // the full form: the Ciphered mode is always offered (with a warning when
  // the pinned version predates encryption), paid modes stay visible as an
  // upsell with a badge rather than disappearing, and only Remote Eval is
  // capability-gated because an SDK without it simply cannot work that way.
  const currentCaps = getConnectionSDKCapabilities(
    { languages: value.languages, sdkVersion: value.sdkVersion },
    "min-ver-intersection",
  );
  const languageChosen = value.languages.length > 0;
  const payloadSecurityAllowed = shouldShowPayloadSecurity(value.languages);
  const encryptionSupported =
    !languageChosen || currentCaps.includes("encryption");
  const remoteEvalSupported =
    !languageChosen || currentCaps.includes("remoteEval");
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint",
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");

  const singleLanguage =
    value.languages.length === 1 ? value.languages[0] : undefined;
  const mapping = singleLanguage ? languageMapping[singleLanguage] : undefined;
  const showVersionPicker =
    !!singleLanguage && !mapping?.hideVersion && singleLanguage !== "other";
  const latestVersion = singleLanguage
    ? getLatestSDKVersion(singleLanguage)
    : undefined;
  // Offer a one-click jump to the newest version when the selected one is
  // behind, as the full form does.
  const versionOutdated =
    !!singleLanguage && isSDKOutdated(singleLanguage, value.sdkVersion);
  const selectedEnvironment = environments.find(
    (e) => e.id === value.environment,
  );
  const environmentHasProjects = !!selectedEnvironment?.projects?.length;

  // Pin the latest version as soon as a language that has versions is chosen.
  // The field already displayed `latestVersion` as a fallback, but the value
  // stayed unset, so a create could save a connection with no version at all.
  useEffect(() => {
    if (showVersionPicker && latestVersion && !value.sdkVersion) {
      onChange({ sdkVersion: latestVersion });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVersionPicker, latestVersion, value.sdkVersion]);

  const securityOptions = [
    {
      value: "plain",
      label: "Plain Text (Default)",
      description:
        "Readable by anyone with the client key. Fastest, most cacheable.",
    },
    ...(payloadSecurityAllowed
      ? [
          {
            value: "ciphered",
            label: (
              <Flex as="span" align="center" gap="2">
                Ciphered
                {!hasEncryptionFeature && (
                  <PaidFeatureBadge commercialFeature="encrypt-features-endpoint" />
                )}
              </Flex>
            ),
            description: "AES-encrypted payload. Obfuscated, still cacheable.",
            renderOnSelect: (
              <Flex direction="column" gap="3" mt="2">
                {/* Hidden when the pinned SDK version predates decryption, as
                    the full form does — unless already on, so it can still be
                    turned off. */}
                {(encryptionSupported || value.encryptPayload) && (
                  <Checkbox
                    label="Encrypt payload"
                    description="AES-encrypt so feature definitions aren't readable with just the client key."
                    value={value.encryptPayload}
                    disabled={!hasEncryptionFeature}
                    setValue={(v) => onChange({ encryptPayload: v })}
                  />
                )}
                {value.encryptPayload && !encryptionSupported && (
                  <Callout status="warning" size="sm">
                    Payload decryption may not be available in your current SDK
                    {singleLanguage &&
                    getSDKCapabilityVersion(singleLanguage, "encryption")
                      ? ` — it was introduced in version ${getSDKCapabilityVersion(
                          singleLanguage,
                          "encryption",
                        )}, and this connection specifies ${
                          value.sdkVersion ?? "an older version"
                        }.`
                      : "."}
                  </Callout>
                )}
                <Checkbox
                  label="Hide names from payload"
                  description="Strip human-readable experiment and variation names."
                  value={!value.includeExperimentNames}
                  setValue={(v) => onChange({ includeExperimentNames: !v })}
                />
                <Checkbox
                  label="Hash secure attributes"
                  description="Anonymize secureString targeting attributes via SHA-256 hashing."
                  value={value.hashSecureAttributes}
                  disabled={!hasSecureAttributesFeature}
                  setValue={(v) => onChange({ hashSecureAttributes: v })}
                />
              </Flex>
            ),
          },
        ]
      : []),
    ...(payloadSecurityAllowed && remoteEvalSupported
      ? [
          {
            value: "remote",
            label: (
              <Flex as="span" align="center" gap="2">
                Remote Eval (Strongest protection)
                {!hasRemoteEvaluationFeature && (
                  <PaidFeatureBadge commercialFeature="remote-evaluation" />
                )}
              </Flex>
            ),
            description:
              "Evaluated server-side. The SDK never receives raw rules. Not cacheable.",
            disabled: !hasRemoteEvaluationFeature,
            renderOnSelect: (
              <Flex direction="column" gap="3" mt="2">
                <Checkbox
                  label="Hide names from payload"
                  description="Strip human-readable experiment and variation names."
                  value={!value.includeExperimentNames}
                  setValue={(v) => onChange({ includeExperimentNames: !v })}
                />
                {isCloud() && (
                  <Callout status="info" size="sm">
                    Cloud customers must self-host a remote evaluation service
                    such as{" "}
                    <a
                      href="https://github.com/growthbook/growthbook-proxy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      GrowthBook Proxy
                    </a>{" "}
                    or a CDN edge worker.
                  </Callout>
                )}
                {(value.encryptPayload ||
                  value.hashSecureAttributes ||
                  !value.includeExperimentNames) && (
                  <Callout status="warning" size="sm">
                    Encryption, secure-attribute hashing and hidden names are
                    not recommended for most remote evaluation configurations —
                    the server already keeps raw rules off the client.
                  </Callout>
                )}
              </Flex>
            ),
          },
        ]
      : []),
  ];

  return (
    <Flex direction="column" gap="4">
      <Field
        label="Connection Name"
        placeholder="My Application"
        value={value.name}
        onChange={(e) => onChange({ name: e.target.value })}
        required
      />

      <SDKLanguageSelector
        value={value.languages}
        setValue={(langs) =>
          // Only pin a version for a single language, as the full form does:
          // clearing it for a multi-language connection would drop a version
          // the connection legitimately still has.
          onChange(
            langs.length === 1
              ? {
                  languages: langs,
                  sdkVersion: getLatestSDKVersion(langs[0] as SDKLanguage),
                }
              : { languages: langs },
          )
        }
        multiple={value.languages.length > 1}
        includeOther={true}
        skipLabel={value.languages.length <= 1}
        hideShowAllLanguages={true}
        languageFilter={languageFilter}
        setLanguageFilter={setLanguageFilter}
      />
      {languageError ? (
        <HelperText status="error">{languageError}</HelperText>
      ) : null}

      <Grid
        columns={{ initial: "1", sm: showVersionPicker ? "2" : "1" }}
        gap="4"
      >
        {showVersionPicker && singleLanguage ? (
          <Box>
            <>
              <SelectField
                label="SDK Version"
                sort={false}
                options={getSDKVersions(singleLanguage).map((ver) => ({
                  label: ver,
                  value: ver,
                }))}
                createable={true}
                isClearable={false}
                value={value.sdkVersion || latestVersion || ""}
                onChange={(v) => onChange({ sdkVersion: v })}
                formatOptionLabel={({ label }) => (
                  <Flex align="center" justify="between" gap="2">
                    <span>{label}</span>
                    {label === latestVersion ? (
                      <Badge color="gray" variant="soft" label="LATEST" />
                    ) : null}
                  </Flex>
                )}
              />
              {versionOutdated && latestVersion ? (
                <Link onClick={() => onChange({ sdkVersion: latestVersion })}>
                  <Text size="sm">Use latest</Text>
                </Link>
              ) : null}
              {mapping?.packageUrl && mapping?.packageName ? (
                <Link
                  href={mapping.packageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Text size="sm">{mapping.packageName} on NPM</Text>
                </Link>
              ) : null}
            </>
          </Box>
        ) : null}
        <SelectField
          label="Environment"
          value={value.environment}
          onChange={(env) => onChange({ environment: env })}
          options={environments.map((env) => ({
            label: env.id,
            value: env.id,
          }))}
          disabled={disableScope}
          required
          sort={false}
          formatOptionLabel={({ label }) => (
            <Flex align="center" justify="between" gap="2">
              <span>{label}</span>
              {!environments.find((e) => e.id === label)?.projects?.length ? (
                <Text size="sm" color="text-mid">
                  Includes all projects
                </Text>
              ) : null}
            </Flex>
          )}
        />
      </Grid>

      <MultiSelectField
        label={
          (
            <Flex align="center" gap="1" as="span">
              Filter by Projects
              <Tooltip body="Only features and experiments in these projects are served by this connection. Leave empty to serve every project the environment allows." />
            </Flex>
          ) as unknown as string
        }
        placeholder={
          environmentHasProjects ? "All Environment Projects" : "All projects"
        }
        value={value.projects}
        onChange={(p) => onChange({ projects: p as string[] })}
        options={projects.map((p) => ({ label: p.name, value: p.id }))}
        disabled={disableScope}
        required={requireProjectSelection}
        sort={false}
        closeMenuOnSelect={true}
      />

      {/* Next.js is plain-text only, so the delivery modes collapse to a
          single choice — but hiding names is orthogonal and stays offered. */}
      {!payloadSecurityAllowed && (
        <Checkbox
          label="Hide names from payload"
          description="Strip human-readable experiment and variation names."
          value={!value.includeExperimentNames}
          setValue={(v) => onChange({ includeExperimentNames: !v })}
        />
      )}
      {payloadSecurityAllowed && (
        <Box>
          <Flex align="center" gap="1" mb="2">
            <Text weight="semibold">Payload Security</Text>
            <Tooltip body="How much of the feature definition the SDK receives, and whether it can be cached." />
          </Flex>
          <RadioGroup
            value={value.delivery}
            setValue={(v) => {
              const patch: Partial<SDKConnectionFieldsValue> = {
                delivery: v as DeliveryMode,
              };
              // Match the full form: entering Ciphered with nothing set
              // pre-enables whichever options the plan allows.
              if (
                v === "ciphered" &&
                !value.encryptPayload &&
                !value.hashSecureAttributes
              ) {
                patch.encryptPayload = hasEncryptionFeature;
                patch.hashSecureAttributes = hasSecureAttributesFeature;
              }
              onChange(patch);
            }}
            options={securityOptions}
          />
        </Box>
      )}
    </Flex>
  );
}
