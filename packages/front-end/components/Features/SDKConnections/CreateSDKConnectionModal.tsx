import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { PiCaretDown } from "react-icons/pi";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getLatestSDKVersion,
} from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import ButtonSelectField from "@/components/Forms/ButtonSelectField";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import SDKLanguageSelector from "@/components/Features/SDKConnections/SDKLanguageSelector";
import {
  LanguageFilter,
  getConnectionLanguageFilter,
} from "@/components/Features/SDKConnections/SDKLanguageLogo";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import { useEnvironments } from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import track from "@/services/track";

type DeliveryMode = "plain" | "ciphered" | "remote";

const DELIVERY_DESCRIPTIONS: Record<DeliveryMode, string> = {
  plain:
    "Full feature definitions are viewable by anyone with the client key. Highly cacheable.",
  ciphered:
    "Payload encrypted (AES) and secure attributes hashed. Adds obfuscation while staying cacheable.",
  remote:
    "Evaluate features server-side; the SDK fetches results only. Best protection, no caching.",
};

export default function CreateSDKConnectionModal({
  close,
  mutate,
}: {
  close: () => void;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const router = useRouter();
  const environments = useEnvironments();
  const { projects, project } = useDefinitions();
  const customFields = useCustomFields();

  // Primary fields
  const [name, setName] = useState("");
  const [languages, setLanguages] = useState<SDKLanguage[]>([]);
  const [sdkVersion, setSdkVersion] = useState<string | undefined>(undefined);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>(
    getConnectionLanguageFilter([]),
  );
  const [environment, setEnvironment] = useState(environments[0]?.id ?? "");
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    project ? [project] : [],
  );
  const [delivery, setDelivery] = useState<DeliveryMode>("plain");
  // Ciphered sub-settings (mirror the original Cipher Options)
  const [encryptPayload, setEncryptPayload] = useState(false);
  const [hashSecureAttributes, setHashSecureAttributes] = useState(false);

  // Advanced
  const [includeRuleIds, setIncludeRuleIds] = useState(true);
  const [includeVisualExperiments, setIncludeVisualExperiments] =
    useState(false);
  const [includeRedirectExperiments, setIncludeRedirectExperiments] =
    useState(false);
  const [includeDraftExperiments, setIncludeDraftExperiments] = useState(false);
  const [includeExperimentNames, setIncludeExperimentNames] = useState(true);
  const [includeTagsInMetadata, setIncludeTagsInMetadata] = useState(false);
  const [includeProjectIdInMetadata, setIncludeProjectIdInMetadata] =
    useState(false);
  const [savedGroupReferencesEnabled, setSavedGroupReferencesEnabled] =
    useState(false);
  const [includeCustomFieldsInMetadata, setIncludeCustomFieldsInMetadata] =
    useState(false);
  const [allowedCustomFieldsInMetadata, setAllowedCustomFieldsInMetadata] =
    useState<string[]>([]);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyHost, setProxyHost] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Scroll newly-expanded content to the top of the modal body so it's easy to
  // read without manual scrolling.
  const advancedRef = useRef<HTMLDivElement>(null);
  const deliveryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (advancedOpen) {
      advancedRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [advancedOpen]);
  useEffect(() => {
    if (delivery === "ciphered" || delivery === "remote") {
      deliveryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [delivery]);

  // Capabilities only drive which advanced settings are relevant. Delivery
  // modes are always selectable — Ciphered surfaces a Paid badge as an upgrade
  // nudge rather than being hard-disabled.
  const capabilities = useMemo(
    () =>
      getConnectionSDKCapabilities(
        { languages, sdkVersion },
        "max-ver-intersection",
      ),
    [languages, sdkVersion],
  );
  const supportsSavedGroups = capabilities.includes("savedGroupReferences");

  // Switching delivery mode seeds sensible defaults for its sub-settings,
  // mirroring the original form's tab behavior.
  const handleDeliveryChange = (mode: DeliveryMode) => {
    setDelivery(mode);
    if (mode === "ciphered") {
      setEncryptPayload(true);
      setHashSecureAttributes(true);
      setIncludeExperimentNames(false);
    } else {
      setEncryptPayload(false);
      setHashSecureAttributes(false);
    }
  };

  const deliveryOptions: {
    label: string | JSX.Element;
    value: DeliveryMode;
    disabled?: boolean;
  }[] = [
    { label: "Plain Text", value: "plain" },
    {
      label: (
        <Flex as="span" align="center" gap="2">
          Ciphered
          <PaidFeatureBadge commercialFeature="encrypt-features-endpoint" />
        </Flex>
      ),
      value: "ciphered",
    },
    {
      label: (
        <Flex as="span" align="center" gap="2">
          Remote Eval
          <PaidFeatureBadge commercialFeature="remote-evaluation" />
        </Flex>
      ),
      value: "remote",
    },
  ];

  return (
    <ModalStandard
      trackingEventModalType="create-sdk-connection"
      open={true}
      close={close}
      header="New SDK Connection"
      cta="Create"
      size="lg"
      submit={async () => {
        if (languages.length === 0) {
          setLanguageError("Please select an SDK language");
          throw new Error("Please select an SDK language");
        }
        setLanguageError(null);

        const isCiphered = delivery === "ciphered";
        const remoteEvalEnabled = delivery === "remote";
        const finalEncryptPayload = isCiphered && encryptPayload;
        const finalHashSecureAttributes = isCiphered && hashSecureAttributes;

        const body = {
          name,
          languages,
          sdkVersion,
          environment,
          projects: selectedProjects,
          encryptPayload: finalEncryptPayload,
          hashSecureAttributes: finalHashSecureAttributes,
          remoteEvalEnabled,
          includeRuleIds,
          includeVisualExperiments,
          includeRedirectExperiments,
          includeDraftExperiments,
          includeExperimentNames,
          includeTagsInMetadata,
          includeProjectIdInMetadata,
          savedGroupReferencesEnabled:
            supportsSavedGroups && savedGroupReferencesEnabled,
          includeCustomFieldsInMetadata,
          allowedCustomFieldsInMetadata: includeCustomFieldsInMetadata
            ? allowedCustomFieldsInMetadata
            : [],
          proxyEnabled,
          proxyHost,
        };

        const res = await apiCall<{ connection: SDKConnectionInterface }>(
          `/sdk-connections`,
          { method: "POST", body: JSON.stringify(body) },
        );
        track("Create SDK Connection", {
          source: "CreateSDKConnectionModal",
          languages,
          encryptPayload: finalEncryptPayload,
          hashSecureAttributes: finalHashSecureAttributes,
          remoteEvalEnabled,
          proxyEnabled,
        });
        mutate();
        await router.push(`/sdks/${res.connection.id}`);
      }}
    >
      <Flex direction="column" gap="4" style={{ minWidth: 0, width: "100%" }}>
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production Web"
          required
        />

        <Box>
          <label
            style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}
            className="d-block"
          >
            SDK Language
          </label>
          <SDKLanguageSelector
            value={languages}
            setValue={(langs) => {
              setLanguages(langs);
              if (langs.length) setLanguageError(null);
              setSdkVersion(
                langs.length === 1 ? getLatestSDKVersion(langs[0]) : undefined,
              );
            }}
            multiple={languages.length > 1}
            includeOther={true}
            skipLabel={languages.length <= 1}
            hideShowAllLanguages={true}
            languageFilter={languageFilter}
            setLanguageFilter={setLanguageFilter}
          />
          {languageError && (
            <HelperText status="error">{languageError}</HelperText>
          )}
        </Box>

        <SelectField
          label="Environment"
          value={environment}
          onChange={setEnvironment}
          options={environments.map((env) => ({
            label: env.id,
            value: env.id,
          }))}
          required
          sort={false}
        />

        <MultiSelectField
          label="Project"
          placeholder="All projects"
          value={selectedProjects}
          onChange={(p) => setSelectedProjects(p as string[])}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          helpText="Leave empty to serve every project allowed in the selected environment."
          sort={false}
          closeMenuOnSelect={true}
        />

        <Box ref={deliveryRef}>
          <ButtonSelectField<DeliveryMode>
            label="Delivery method"
            value={delivery}
            setValue={handleDeliveryChange}
            options={deliveryOptions}
          />
          <Box mt="2">
            <Text size="small" color="text-mid">
              {DELIVERY_DESCRIPTIONS[delivery]}
            </Text>
          </Box>

          {delivery === "ciphered" && (
            <Box
              mt="3"
              p="3"
              style={{
                background: "var(--gray-a2)",
                borderRadius: 8,
              }}
            >
              <Flex direction="column" gap="3">
                <Switch
                  label={
                    <Flex as="span" align="center" gap="2">
                      Encrypt payload
                      <PaidFeatureBadge commercialFeature="encrypt-features-endpoint" />
                    </Flex>
                  }
                  description="Encrypt the SDK payload with AES so feature definitions aren't readable by anyone with the client key."
                  value={encryptPayload}
                  onChange={setEncryptPayload}
                />
                <Switch
                  label={
                    <Flex as="span" align="center" gap="2">
                      Hash secure attributes
                      <PaidFeatureBadge commercialFeature="hash-secure-attributes" />
                    </Flex>
                  }
                  description="Anonymize secureString targeting attributes via SHA-256 hashing."
                  value={hashSecureAttributes}
                  onChange={setHashSecureAttributes}
                />
                <Switch
                  label="Hide experiment and variation names"
                  description="Strip human-readable experiment and variation names from the payload."
                  value={!includeExperimentNames}
                  onChange={(v) => setIncludeExperimentNames(!v)}
                />
              </Flex>
            </Box>
          )}

          {delivery === "remote" && (
            <Box mt="3">
              <Callout status="info" size="sm">
                Remote evaluation requires a self-hosted evaluation service such
                as{" "}
                <a
                  href="https://github.com/growthbook/growthbook-proxy"
                  target="_blank"
                  rel="noreferrer"
                >
                  GrowthBook Proxy
                </a>{" "}
                or a CDN edge worker
                {isCloud() ? " (required for Cloud accounts)." : "."}
              </Callout>
            </Box>
          )}
        </Box>

        <Box
          ref={advancedRef}
          style={{
            border: "1px solid var(--gray-a5)",
            borderRadius: 8,
            overflow: "hidden",
            scrollMarginTop: 8,
          }}
        >
          <Flex
            align="center"
            justify="between"
            gap="2"
            px="3"
            py="3"
            onClick={() => setAdvancedOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setAdvancedOpen((v) => !v);
              }
            }}
            style={{
              cursor: "pointer",
              userSelect: "none",
              background: "var(--gray-a2)",
              borderBottom: advancedOpen
                ? "1px solid var(--gray-a5)"
                : undefined,
            }}
          >
            <Flex align="center" gap="2">
              <Text size="medium" weight="medium">
                Advanced settings
              </Text>
              {!advancedOpen && (
                <Text size="small" color="text-mid">
                  Features &amp; Experiments · Payload Metadata · Proxy
                </Text>
              )}
            </Flex>
            <PiCaretDown
              size={16}
              style={{
                color: "var(--gray-11)",
                transition: "transform 180ms ease",
                transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </Flex>
          {advancedOpen && (
            <Box p="3">
              <Flex direction="column" gap="4">
                <AdvancedGroup title="Features & Experiments">
                  <Switch
                    label="Rule IDs"
                    description="Include feature rule IDs in the payload."
                    value={includeRuleIds}
                    onChange={setIncludeRuleIds}
                  />
                  <Switch
                    label="Visual Editor"
                    value={includeVisualExperiments}
                    onChange={setIncludeVisualExperiments}
                  />
                  <Switch
                    label="URL Redirects"
                    value={includeRedirectExperiments}
                    onChange={setIncludeRedirectExperiments}
                  />
                  <Switch
                    label="Draft Experiments"
                    value={includeDraftExperiments}
                    onChange={setIncludeDraftExperiments}
                  />
                </AdvancedGroup>

                <AdvancedGroup title="Payload Metadata">
                  <Switch
                    label="Tags in Metadata"
                    value={includeTagsInMetadata}
                    onChange={setIncludeTagsInMetadata}
                  />
                  <Switch
                    label="Project IDs in Metadata"
                    value={includeProjectIdInMetadata}
                    onChange={setIncludeProjectIdInMetadata}
                  />
                  {supportsSavedGroups && (
                    <Switch
                      label="Saved Group References"
                      value={savedGroupReferencesEnabled}
                      onChange={setSavedGroupReferencesEnabled}
                    />
                  )}
                  <Switch
                    label="Custom Fields"
                    value={includeCustomFieldsInMetadata}
                    onChange={(v) => {
                      setIncludeCustomFieldsInMetadata(v);
                      if (!v) setAllowedCustomFieldsInMetadata([]);
                    }}
                  />
                  {includeCustomFieldsInMetadata && (
                    <MultiSelectField
                      label="Allowed custom fields"
                      placeholder="No fields included"
                      value={allowedCustomFieldsInMetadata}
                      onChange={(fields) =>
                        setAllowedCustomFieldsInMetadata(fields as string[])
                      }
                      options={(customFields || []).map((cf) => ({
                        label: cf.name,
                        value: cf.id,
                      }))}
                      sort={false}
                      closeMenuOnSelect={true}
                    />
                  )}
                </AdvancedGroup>

                {isCloud() && (
                  <AdvancedGroup title="GrowthBook Proxy">
                    <Switch
                      label="Use GrowthBook Proxy"
                      description="Route SDK requests through a self-hosted proxy."
                      value={proxyEnabled}
                      onChange={setProxyEnabled}
                    />
                    {proxyEnabled && (
                      <Field
                        label="Proxy Host URL"
                        placeholder="https://"
                        value={proxyHost}
                        onChange={(e) => setProxyHost(e.target.value)}
                      />
                    )}
                  </AdvancedGroup>
                )}
              </Flex>
            </Box>
          )}
        </Box>
      </Flex>
    </ModalStandard>
  );
}

function AdvancedGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Box
        mb="2"
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "var(--gray-11)",
        }}
      >
        {title}
      </Box>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Box>
  );
}
