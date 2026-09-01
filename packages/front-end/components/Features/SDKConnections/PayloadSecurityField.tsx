import { SDKLanguage } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import {
  DeliveryMode,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";

export type PayloadSecurityValue = {
  delivery: DeliveryMode;
  encryptPayload: boolean;
  hashSecureAttributes: boolean;
  includeExperimentNames: boolean;
};

/**
 * Payload Security for an SDK connection: Plain Text / Ciphered / Remote Eval
 * with the nested cipher options. Shared by the create/edit modal and the
 * section editor so per-SDK gating and entitlements can't drift between them.
 *
 * Mirrors the full form: Ciphered is always offered and its options are gated
 * individually, paid options stay visible as a badge-marked upsell, and only
 * Remote Eval is hidden outright when the pinned SDK version can't do it.
 */
export default function PayloadSecurityField({
  value,
  onChange,
  languages,
  sdkVersion,
  disabled = false,
}: {
  value: PayloadSecurityValue;
  onChange: (patch: Partial<PayloadSecurityValue>) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  /** Externally managed connections are read-only. */
  disabled?: boolean;
}) {
  const { hasCommercialFeature } = useUser();
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint",
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");

  const currentCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "min-ver-intersection",
  );
  // Capabilities are meaningless until a language is picked.
  const languageChosen = languages.length > 0;
  const encryptionSupported =
    !languageChosen || currentCaps.includes("encryption");
  const remoteEvalSupported =
    !languageChosen || currentCaps.includes("remoteEval");
  const singleLanguage = languages.length === 1 ? languages[0] : undefined;
  const encryptionVersion = singleLanguage
    ? getSDKCapabilityVersion(singleLanguage, "encryption")
    : undefined;

  const hideNames = (
    <Checkbox
      label="Hide names from payload"
      description="Strip human-readable experiment and variation names."
      value={!value.includeExperimentNames}
      disabled={disabled}
      setValue={(v) => onChange({ includeExperimentNames: !v })}
    />
  );

  // Next.js is plain-text only, so the delivery modes collapse to a single
  // choice — but hiding names is orthogonal and stays offered.
  if (!shouldShowPayloadSecurity(languages)) return hideNames;

  const options = [
    {
      value: "plain",
      label: "Plain Text (Default)",
      description:
        "Readable by anyone with the client key. Fastest, most cacheable.",
    },
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
          {/* Hidden when the pinned SDK version predates decryption, as the
              full form does — unless already on, so it can still be turned
              off. */}
          {(encryptionSupported || value.encryptPayload) && (
            <Checkbox
              label="Encrypt payload"
              description="AES-encrypt so feature definitions aren't readable with just the client key."
              value={value.encryptPayload}
              disabled={disabled || !hasEncryptionFeature}
              setValue={(v) => onChange({ encryptPayload: v })}
            />
          )}
          {value.encryptPayload && !encryptionSupported && (
            <Callout status="warning" size="sm">
              Payload decryption may not be available in your current SDK
              {encryptionVersion
                ? ` — it was introduced in version ${encryptionVersion}, and this connection specifies ${
                    sdkVersion ?? "an older version"
                  }.`
                : "."}
            </Callout>
          )}
          {hideNames}
          <Checkbox
            label="Hash secure attributes"
            description="Anonymize secureString targeting attributes via SHA-256 hashing."
            value={value.hashSecureAttributes}
            disabled={disabled || !hasSecureAttributesFeature}
            setValue={(v) => onChange({ hashSecureAttributes: v })}
          />
        </Flex>
      ),
    },
    ...(remoteEvalSupported
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
                {hideNames}
                {isCloud() && (
                  <Callout status="info" size="sm">
                    Cloud customers must self-host a remote evaluation service
                    such as{" "}
                    <Link
                      href="https://github.com/growthbook/growthbook-proxy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      GrowthBook Proxy
                    </Link>{" "}
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
    <Box>
      <Flex align="center" gap="1" mb="2">
        <Text weight="semibold">Payload Security</Text>
        <Tooltip body="How much of the feature definition the SDK receives, and whether it can be cached." />
      </Flex>
      <RadioGroup
        disabled={disabled}
        value={value.delivery}
        setValue={(v) => {
          const patch: Partial<PayloadSecurityValue> = {
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
        options={options}
      />
    </Box>
  );
}
