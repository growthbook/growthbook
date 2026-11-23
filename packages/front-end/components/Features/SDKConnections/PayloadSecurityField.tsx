import { ReactNode } from "react";
import {
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getDefaultSDKVersion,
  getSDKCapabilityVersion,
} from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import {
  connectionCapabilities,
  DeliveryMode,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  DELIVERY_LABELS,
  InfoTooltip,
  SETTING_PREMIUM_TIP,
  SETTING_TITLES,
  WithInfoIcon,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";

export const CIPHER_OPTIONS_TITLE = "Cipher Options";
export const REMOTE_EVAL_OPTIONS_TITLE = "Remote Eval Options";

export type PayloadSecurityValue = {
  delivery: DeliveryMode;
  encryptPayload: boolean;
  hashSecureAttributes: boolean;
};

// The premium settings on in the live connection. They stay available after
// the plan drops them, as the server keeps them.
export type KeptPremiumSettings = Pick<
  SDKConnectionInterface,
  "encryptPayload" | "hashSecureAttributes" | "remoteEvalEnabled"
>;

const KEPT_SETTING_NOTE =
  "Your plan no longer includes this setting. It stays on for this SDK Connection, but if you turn it off and save, you'll need to upgrade to turn it back on.";

type FieldProps = {
  value: PayloadSecurityValue;
  onChange: (patch: Partial<PayloadSecurityValue>) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  kept?: KeptPremiumSettings;
  // Rows that supply their own label.
  hideLabel?: boolean;
  // Read-only: the caller can't edit this connection.
  disabled?: boolean;
};

function usePayloadSecurity(
  languages: SDKLanguage[],
  sdkVersion?: string,
  kept?: KeptPremiumSettings,
) {
  const { hasCommercialFeature } = useUser();
  const { currentCaps } = connectionCapabilities({ languages, sdkVersion });
  const singleLanguage = languages.length === 1 ? languages[0] : undefined;
  const hasEncryptionFeature = hasCommercialFeature(
    "encrypt-features-endpoint",
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes",
  );
  const hasRemoteEvaluationFeature = hasCommercialFeature("remote-evaluation");
  const keptNote = (hasFeature: boolean, on?: boolean) =>
    !hasFeature && on ? KEPT_SETTING_NOTE : undefined;
  return {
    allowed: shouldShowPayloadSecurity(languages),
    hasEncryptionFeature,
    canEncrypt: hasEncryptionFeature || !!kept?.encryptPayload,
    canHashSecureAttributes:
      hasSecureAttributesFeature || !!kept?.hashSecureAttributes,
    canRemoteEval: hasRemoteEvaluationFeature || !!kept?.remoteEvalEnabled,
    encryptionKeptNote: keptNote(hasEncryptionFeature, kept?.encryptPayload),
    secureAttributesKeptNote: keptNote(
      hasSecureAttributesFeature,
      kept?.hashSecureAttributes,
    ),
    remoteEvalKeptNote: keptNote(
      hasRemoteEvaluationFeature,
      kept?.remoteEvalEnabled,
    ),
    encryptionSupported: currentCaps.includes("encryption"),
    remoteEvalSupported: currentCaps.includes("remoteEval"),
    singleLanguage,
    encryptionVersion: singleLanguage
      ? getSDKCapabilityVersion(singleLanguage, "encryption")
      : undefined,
  };
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text as="div" weight="semibold" mb="2">
      {children}
    </Text>
  );
}

const remoteEvalTooltip = (
  <>
    <Text as="p" mb="2">
      <strong>Remote Evaluation</strong> fully secures your SDK by evaluating
      feature flags exclusively on a private server instead of within a
      front-end environment. This ensures that any sensitive information within
      targeting rules or unused feature variations are never seen by the client.
    </Text>
    <Text as="p" mb="2">
      Remote evaluation provides the same security benefits as a backend SDK.
      However, remote evaluation is neither needed nor supported for backend
      SDKs.
    </Text>
    <Text as="div" mb="2">
      Remote evaluation does come with a few cost considerations:
      <Flex asChild direction="column" gap="2" pl="4" mt="2">
        <ol>
          <li>
            It will increase network traffic. Evaluated payloads cannot be
            shared across different users; therefore CDN cache misses will
            increase.
          </li>
          <li>
            Any connections using Streaming Updates will incur a slight delay.
            An additional network hop is required to retrieve the evaluated
            payload from the server.
          </li>
        </ol>
      </Flex>
    </Text>
  </>
);

type CipherOption = Pick<
  Partial<PayloadSecurityValue>,
  "encryptPayload" | "hashSecureAttributes"
>;

// Encrypting the payload and hashing secure attributes.
function CipherCheckboxes({
  value,
  setOption,
  languages,
  sdkVersion,
  kept,
  disabled,
}: {
  value: PayloadSecurityValue;
  setOption: (patch: CipherOption) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  kept?: KeptPremiumSettings;
  disabled: boolean;
}) {
  const {
    canEncrypt,
    canHashSecureAttributes,
    encryptionKeptNote,
    secureAttributesKeptNote,
    encryptionSupported,
    singleLanguage,
    encryptionVersion,
  } = usePayloadSecurity(languages, sdkVersion, kept);
  return (
    <>
      {encryptionSupported && (
        <Checkbox
          weight="regular"
          value={value.encryptPayload}
          disabled={disabled || !canEncrypt}
          error={encryptionKeptNote}
          errorLevel="warning"
          setValue={(v) => setOption({ encryptPayload: v })}
          label={
            <PremiumTooltip
              commercialFeature="encrypt-features-endpoint"
              {...SETTING_PREMIUM_TIP}
              body={
                <>
                  <p>
                    SDK payloads will be encrypted via the AES encryption
                    algorithm. When evaluating feature flags in a public or
                    insecure environment (such as a browser), encryption
                    provides an additional layer of security through
                    obfuscation. This allows you to target users based on
                    sensitive attributes.
                  </p>
                  <HelperText status="warning" size="sm">
                    When using an insecure environment, do not rely exclusively
                    on payload encryption as a means of securing highly
                    sensitive data. Because the client performs the decryption,
                    the unencrypted payload may be extracted with sufficient
                    effort.
                  </HelperText>
                </>
              }
            >
              <WithInfoIcon>{SETTING_TITLES.encryptPayload}</WithInfoIcon>
            </PremiumTooltip>
          }
        />
      )}
      <Checkbox
        weight="regular"
        value={value.hashSecureAttributes}
        disabled={disabled || !canHashSecureAttributes}
        error={secureAttributesKeptNote}
        errorLevel="warning"
        setValue={(v) => setOption({ hashSecureAttributes: v })}
        label={
          <PremiumTooltip
            commercialFeature="hash-secure-attributes"
            {...SETTING_PREMIUM_TIP}
            body={
              <>
                <p>
                  Feature targeting conditions referencing{" "}
                  <code>secureString</code> attributes will be anonymized via
                  SHA-256 hashing. When evaluating feature flags in a public or
                  insecure environment (such as a browser), hashing provides an
                  additional layer of security through obfuscation. This allows
                  you to target users based on sensitive attributes.
                </p>
                <HelperText status="warning" size="sm">
                  When using an insecure environment, do not rely exclusively on
                  hashing as a means of securing highly sensitive data. Hashing
                  is an obfuscation technique that makes it very difficult, but
                  not impossible, to extract sensitive data.
                </HelperText>
              </>
            }
          >
            <WithInfoIcon>{SETTING_TITLES.hashSecureAttributes}</WithInfoIcon>
          </PremiumTooltip>
        }
      />
      {value.encryptPayload && !encryptionSupported && (
        <Callout status="warning" size="sm">
          Payload decryption may not be available in your current SDK.
          {singleLanguage && encryptionVersion ? (
            <>
              {" "}
              It was introduced in SDK version <code>{encryptionVersion}</code>.
              The SDK version specified in this connection is{" "}
              <code>{sdkVersion || getDefaultSDKVersion(singleLanguage)}</code>.
            </>
          ) : null}
        </Callout>
      )}
    </>
  );
}

// What a ciphered payload obscures.
export function CipherOptionsField({
  value,
  onChange,
  languages,
  sdkVersion,
  kept,
  hideLabel = false,
  disabled = false,
}: FieldProps) {
  if (!shouldShowPayloadSecurity(languages) || value.delivery !== "ciphered") {
    return null;
  }

  // With neither option left, the payload is plain.
  const setOption = (patch: CipherOption) => {
    const next = { ...value, ...patch };
    onChange(
      next.encryptPayload || next.hashSecureAttributes
        ? patch
        : { ...patch, delivery: "plain" },
    );
  };

  return (
    <Box>
      {!hideLabel && <FieldLabel>{CIPHER_OPTIONS_TITLE}</FieldLabel>}
      <Flex direction="column" gap="3">
        <CipherCheckboxes
          value={value}
          setOption={setOption}
          languages={languages}
          sdkVersion={sdkVersion}
          kept={kept}
          disabled={disabled}
        />
      </Flex>
    </Box>
  );
}

// Remote evaluation offers no cipher options; one saved before is kept and
// warned about.
export function RemoteEvalOptionsField({
  value,
  languages,
  includeExperimentNames = true,
  hideLabel = false,
}: Pick<FieldProps, "value" | "languages" | "hideLabel"> & {
  includeExperimentNames?: boolean;
}) {
  if (!shouldShowPayloadSecurity(languages) || value.delivery !== "remote") {
    return null;
  }
  const active = [
    value.encryptPayload && SETTING_TITLES.encryptPayload,
    value.hashSecureAttributes && SETTING_TITLES.hashSecureAttributes,
    !includeExperimentNames && "Hide experiment and variation names",
  ].filter((a): a is string => !!a);
  if (!isCloud() && !active.length) return null;

  return (
    <Box>
      {!hideLabel && <FieldLabel>{REMOTE_EVAL_OPTIONS_TITLE}</FieldLabel>}
      <Flex direction="column" gap="3">
        {isCloud() && (
          <Callout status="info" size="sm">
            Cloud customers must self-host a remote evaluation service such as{" "}
            <Link
              href="https://github.com/growthbook/growthbook-proxy"
              external
            >
              GrowthBook Proxy
            </Link>{" "}
            or a CDN edge worker.
          </Callout>
        )}
        {active.length > 0 && (
          <Callout status="warning" size="sm">
            <strong>{active.join(", ")}</strong>{" "}
            {active.length === 1 ? "is" : "are"} not recommended for most remote
            evaluation configurations and {active.length === 1 ? "is" : "are"} a
            more advanced use case.
          </Callout>
        )}
      </Flex>
    </Box>
  );
}

// How the payload is delivered. Its cipher and remote evaluation options are
// their own fields, beneath it.
export default function PayloadSecurityField({
  value,
  onChange,
  languages,
  sdkVersion,
  kept,
  hideLabel = false,
  disabled = false,
}: FieldProps) {
  const {
    allowed,
    hasEncryptionFeature,
    canEncrypt,
    canHashSecureAttributes,
    canRemoteEval,
    remoteEvalKeptNote,
    remoteEvalSupported,
  } = usePayloadSecurity(languages, sdkVersion, kept);
  if (!allowed) return null;

  const options = [
    {
      value: "plain",
      label: (
        <Flex as="span" align="center" gap="1">
          {DELIVERY_LABELS.plain}
          <InfoTooltip content="Full feature definitions, including targeting conditions and experiment variations, are viewable by anyone with the Client Key." />
        </Flex>
      ),
      description: "Highly cacheable, but may leak sensitive info to users",
    },
    {
      value: "ciphered",
      label: (
        <Flex as="span" align="center" gap="2">
          <Flex as="span" align="center" gap="1">
            {DELIVERY_LABELS.ciphered}
            <InfoTooltip content="Full feature definitions are encrypted and sensitive targeting conditions are hashed to help avoid leaking business logic to client-side apps. Not 100% secure, but will stop most prying eyes." />
          </Flex>
          {!hasEncryptionFeature && (
            <PaidFeatureBadge commercialFeature="encrypt-features-endpoint" />
          )}
        </Flex>
      ),
      description: "Adds obfuscation while remaining cacheable",
    },
    ...(remoteEvalSupported
      ? [
          {
            value: "remote",
            label: (
              <PremiumTooltip
                commercialFeature="remote-evaluation"
                {...SETTING_PREMIUM_TIP}
                tipMinWidth="600px"
                body={remoteEvalTooltip}
              >
                <WithInfoIcon>{DELIVERY_LABELS.remote}</WithInfoIcon>
              </PremiumTooltip>
            ),
            description: "Completely hides business logic from users",
            disabled: !canRemoteEval,
            error: remoteEvalKeptNote,
            errorLevel: "warning" as const,
          },
        ]
      : []),
  ];

  return (
    <Box>
      {!hideLabel && (
        <Flex align="center" gap="1" mb="2">
          <Text weight="semibold">{CATEGORY_TITLES.payloadSecurity}</Text>
          <InfoTooltip content="How much of the feature definition the SDK receives, and whether it can be cached." />
        </Flex>
      )}
      <RadioGroup
        disabled={disabled}
        value={value.delivery}
        setValue={(v) => {
          const mode = v as DeliveryMode;
          const patch: Partial<PayloadSecurityValue> = { delivery: mode };
          if (mode === "plain" || mode === "remote") {
            patch.encryptPayload = false;
            patch.hashSecureAttributes = false;
          } else if (!value.encryptPayload && !value.hashSecureAttributes) {
            patch.encryptPayload = canEncrypt;
            patch.hashSecureAttributes = canHashSecureAttributes;
          }
          onChange(patch);
        }}
        options={options}
      />
    </Box>
  );
}
