import { ReactNode } from "react";
import { SDKLanguage } from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
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
  DeliveryMode,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  CATEGORY_TITLES,
  DELIVERY_LABELS,
  InfoTooltip,
  SETTING_PREMIUM_TIP,
  WithInfoIcon,
} from "@/components/Features/SDKConnections/sdkConnectionSettingLabels";

export const CIPHER_OPTIONS_TITLE = "Cipher Options";
export const REMOTE_EVAL_OPTIONS_TITLE = "Remote Eval Options";

export type PayloadSecurityValue = {
  delivery: DeliveryMode;
  encryptPayload: boolean;
  hashSecureAttributes: boolean;
};

type FieldProps = {
  value: PayloadSecurityValue;
  onChange: (patch: Partial<PayloadSecurityValue>) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  // Rows that supply their own label.
  hideLabel?: boolean;
  // Read-only: the caller can't edit this connection.
  disabled?: boolean;
};

function usePayloadSecurity(languages: SDKLanguage[], sdkVersion?: string) {
  const { hasCommercialFeature } = useUser();
  const currentCaps = getConnectionSDKCapabilities(
    { languages, sdkVersion },
    "min-ver-intersection",
  );
  const singleLanguage = languages.length === 1 ? languages[0] : undefined;
  return {
    allowed: shouldShowPayloadSecurity(languages),
    hasEncryptionFeature: hasCommercialFeature("encrypt-features-endpoint"),
    hasSecureAttributesFeature: hasCommercialFeature("hash-secure-attributes"),
    hasRemoteEvaluationFeature: hasCommercialFeature("remote-evaluation"),
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

// Encrypting the payload and hashing secure attributes, wherever they're
// offered.
function CipherCheckboxes({
  value,
  setOption,
  languages,
  sdkVersion,
  disabled,
}: {
  value: PayloadSecurityValue;
  setOption: (patch: CipherOption) => void;
  languages: SDKLanguage[];
  sdkVersion?: string;
  disabled: boolean;
}) {
  const {
    hasEncryptionFeature,
    hasSecureAttributesFeature,
    encryptionSupported,
    singleLanguage,
    encryptionVersion,
  } = usePayloadSecurity(languages, sdkVersion);
  return (
    <>
      {encryptionSupported && (
        <Checkbox
          weight="regular"
          value={value.encryptPayload}
          disabled={disabled || !hasEncryptionFeature}
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
              <WithInfoIcon>Encrypt payload</WithInfoIcon>
            </PremiumTooltip>
          }
        />
      )}
      <Checkbox
        weight="regular"
        value={value.hashSecureAttributes}
        disabled={disabled || !hasSecureAttributesFeature}
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
            <WithInfoIcon>Hash secure attributes</WithInfoIcon>
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
          disabled={disabled}
        />
      </Flex>
    </Box>
  );
}

// Remote evaluation offers no cipher options. One saved before is kept, and
// warned about as the connection form did.
export function RemoteEvalOptionsField({
  value,
  languages,
  includeExperimentNames = true,
  hideLabel = false,
}: FieldProps & { includeExperimentNames?: boolean }) {
  if (!shouldShowPayloadSecurity(languages) || value.delivery !== "remote") {
    return null;
  }
  const active = [
    value.encryptPayload && "Encrypt payload",
    value.hashSecureAttributes && "Hash secure attributes",
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
  hideLabel = false,
  disabled = false,
}: FieldProps) {
  const {
    allowed,
    hasEncryptionFeature,
    hasSecureAttributesFeature,
    hasRemoteEvaluationFeature,
    remoteEvalSupported,
  } = usePayloadSecurity(languages, sdkVersion);
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
            disabled: !hasRemoteEvaluationFeature,
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
          } else if (
            mode === "ciphered" &&
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
