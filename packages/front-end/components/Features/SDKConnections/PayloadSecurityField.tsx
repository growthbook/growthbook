import { useEffect } from "react";
import { PiInfo } from "react-icons/pi";
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
import RadioGroup from "@/ui/RadioGroup";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
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
 * Payload Security for an SDK connection: Plain Text / Ciphered / Remote Eval,
 * with the full form's Cipher Options nested under the two secured modes.
 * Shared by the create/edit modal and the section editor so gating and
 * entitlements can't drift between them.
 *
 * Same behaviour as the full form's tabs, in the new layout: Plain Text clears
 * everything, entering Ciphered pre-enables the plan's cipher options, Remote
 * Eval leaves them alone, and a remotely evaluated payload can still be
 * encrypted and hashed. The radio itself is the remote-eval toggle.
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
  // Gated on the pinned version's capabilities exactly as the full form is —
  // with no language chosen yet, neither is offered.
  const encryptionSupported = currentCaps.includes("encryption");
  const remoteEvalSupported = currentCaps.includes("remoteEval");
  const singleLanguage = languages.length === 1 ? languages[0] : undefined;
  const encryptionVersion = singleLanguage
    ? getSDKCapabilityVersion(singleLanguage, "encryption")
    : undefined;

  // Next.js is plain-text only, so the full form hides the whole section and
  // forces Plain Text.
  const allowed = shouldShowPayloadSecurity(languages);
  useEffect(() => {
    if (
      !allowed &&
      (value.delivery !== "plain" ||
        value.encryptPayload ||
        value.hashSecureAttributes)
    ) {
      onChange({
        delivery: "plain",
        encryptPayload: false,
        hashSecureAttributes: false,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    allowed,
    value.delivery,
    value.encryptPayload,
    value.hashSecureAttributes,
  ]);
  if (!allowed) return null;

  const cipherOptions = (
    <Box>
      <Text as="div" size="md" weight="medium" mb="2">
        Cipher Options
      </Text>
      <Flex direction="column" gap="3">
        {/* Only offered when the pinned SDK version can decrypt, as on the
            full form. */}
        {encryptionSupported && (
          <Checkbox
            weight="regular"
            value={value.encryptPayload}
            disabled={disabled || !hasEncryptionFeature}
            setValue={(v) => onChange({ encryptPayload: v })}
            label={
              <PremiumTooltip
                commercialFeature="encrypt-features-endpoint"
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
                      When using an insecure environment, do not rely
                      exclusively on payload encryption as a means of securing
                      highly sensitive data. Because the client performs the
                      decryption, the unencrypted payload may be extracted with
                      sufficient effort.
                    </HelperText>
                  </>
                }
              >
                Encrypt payload <PiInfo />
              </PremiumTooltip>
            }
          />
        )}
        <Checkbox
          weight="regular"
          value={value.hashSecureAttributes}
          disabled={disabled || !hasSecureAttributesFeature}
          setValue={(v) => onChange({ hashSecureAttributes: v })}
          label={
            <PremiumTooltip
              commercialFeature="hash-secure-attributes"
              body={
                <>
                  <p>
                    Feature targeting conditions referencing{" "}
                    <code>secureString</code> attributes will be anonymized via
                    SHA-256 hashing. When evaluating feature flags in a public
                    or insecure environment (such as a browser), hashing
                    provides an additional layer of security through
                    obfuscation. This allows you to target users based on
                    sensitive attributes.
                  </p>
                  <HelperText status="warning" size="sm">
                    When using an insecure environment, do not rely exclusively
                    on hashing as a means of securing highly sensitive data.
                    Hashing is an obfuscation technique that makes it very
                    difficult, but not impossible, to extract sensitive data.
                  </HelperText>
                </>
              }
            >
              Hash secure attributes <PiInfo />
            </PremiumTooltip>
          }
        />
        {value.encryptPayload && !encryptionSupported && (
          <Callout status="warning" size="sm">
            Payload decryption may not be available in your current SDK.
            {singleLanguage && encryptionVersion ? (
              <>
                {" "}
                It was introduced in SDK version{" "}
                <code>{encryptionVersion}</code>. The SDK version specified in
                this connection is{" "}
                <code>
                  {sdkVersion || getDefaultSDKVersion(singleLanguage)}
                </code>
                .
              </>
            ) : null}
          </Callout>
        )}
      </Flex>
    </Box>
  );

  // The full form's warning for cipher options combined with remote eval.
  const activeCipherOptions = [
    value.encryptPayload && "Encrypt payload",
    value.hashSecureAttributes && "Hash secure attributes",
    !value.includeExperimentNames && "Hide experiment and variation names",
  ].filter(Boolean) as string[];

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
      renderOnSelect: <Box mt="2">{cipherOptions}</Box>,
    },
    ...(remoteEvalSupported
      ? [
          {
            value: "remote",
            label: (
              <Flex as="span" align="center" gap="2">
                <PremiumTooltip
                  commercialFeature="remote-evaluation"
                  tipMinWidth="600px"
                  body={
                    <>
                      <div className="mb-2">
                        <strong>Remote Evaluation</strong> fully secures your
                        SDK by evaluating feature flags exclusively on a private
                        server instead of within a front-end environment. This
                        ensures that any sensitive information within targeting
                        rules or unused feature variations are never seen by the
                        client.
                      </div>
                      <div className="mb-2">
                        Remote evaluation provides the same security benefits as
                        a backend SDK. However, remote evaluation is neither
                        needed nor supported for backend SDKs.
                      </div>
                      <div className="mb-2">
                        Remote evaluation does come with a few cost
                        considerations:
                        <ol className="pl-3 mt-2">
                          <li className="mb-2">
                            It will increase network traffic. Evaluated payloads
                            cannot be shared across different users; therefore
                            CDN cache misses will increase.
                          </li>
                          <li>
                            Any connections using Streaming Updates will incur a
                            slight delay. An additional network hop is required
                            to retrieve the evaluated payload from the server.
                          </li>
                        </ol>
                      </div>
                    </>
                  }
                >
                  Remote Eval (Strongest protection) <PiInfo />
                </PremiumTooltip>
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
                {cipherOptions}
                {activeCipherOptions.length > 0 && (
                  <Callout status="warning" size="sm">
                    <strong>{activeCipherOptions.join(", ")}</strong>{" "}
                    {activeCipherOptions.length === 1 ? "is" : "are"} not
                    recommended for most remote evaluation configurations and{" "}
                    {activeCipherOptions.length === 1 ? "is" : "are"} a more
                    advanced use case.
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
          const mode = v as DeliveryMode;
          const patch: Partial<PayloadSecurityValue> = { delivery: mode };
          if (mode === "plain" || mode === "remote") {
            // As the full form's tabs: Plain Text and Remote Eval both clear
            // the cipher options (they can be re-enabled under Remote Eval).
            patch.encryptPayload = false;
            patch.hashSecureAttributes = false;
          } else if (
            mode === "ciphered" &&
            !value.encryptPayload &&
            !value.hashSecureAttributes
          ) {
            // Entering Ciphered with nothing set pre-enables whichever
            // options the plan allows.
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
