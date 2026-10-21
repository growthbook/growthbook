import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiKeyInterface } from "shared/types/apikey";
import { ROTATION_GRACE_PRESET_HOURS } from "shared/api-key-expiration";
import { datetime } from "shared/dates";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import RadioGroup from "@/ui/RadioGroup";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

export type RotatedApiKey = {
  key: string;
  expiresAt: string | null;
  previousKeyExpiresAt: string | null;
};

const GRACE_LABELS: Record<number, string> = {
  0: "Immediately",
  1: "After 1 hour",
  24: "After 24 hours",
  168: "After 7 days",
};

export function RotateApiKeyModal({
  apiKey,
  onRotate,
  close,
}: {
  apiKey: ApiKeyInterface;
  onRotate: (gracePeriodHours: number) => Promise<void>;
  close: () => void;
}) {
  const [gracePeriodHours, setGracePeriodHours] = useState("24");

  return (
    <ModalStandard
      trackingEventModalType="rotate-api-key"
      open
      header={`Rotate "${apiKey.description || apiKey.id}"`}
      cta="Rotate"
      ctaColor={gracePeriodHours === "0" ? "red" : "violet"}
      close={close}
      submit={() => onRotate(parseInt(gracePeriodHours))}
    >
      <Text as="p" mb="3">
        The key gets a new secret, and any expiration restarts. Its ID, role and
        permissions stay the same.
      </Text>
      <Text as="p" weight="medium" mb="2">
        Stop accepting the current secret
      </Text>
      <RadioGroup
        value={gracePeriodHours}
        setValue={setGracePeriodHours}
        options={ROTATION_GRACE_PRESET_HOURS.map((hours) => ({
          value: String(hours),
          label: GRACE_LABELS[hours],
        }))}
      />
      {gracePeriodHours === "0" && (
        <Callout status="warning" mt="3">
          Requests using the current secret will be rejected as soon as you
          rotate.
        </Callout>
      )}
    </ModalStandard>
  );
}

export function RotatedApiKeyModal({
  rotated,
  close,
}: {
  rotated: RotatedApiKey;
  close: () => void;
}) {
  return (
    <ModalStandard
      trackingEventModalType=""
      open
      header="Key Rotated"
      close={close}
      closeCta="Done"
    >
      <Flex direction="column" gap="3">
        <Text as="p">Update your clients to use the new secret:</Text>
        <code>{rotated.key}</code>
        <Text as="p" color="text-low">
          {rotated.previousKeyExpiresAt
            ? `The previous secret keeps working until ${datetime(rotated.previousKeyExpiresAt)}.`
            : "The previous secret no longer works."}
          {rotated.expiresAt &&
            ` The key now expires ${datetime(rotated.expiresAt)}.`}
        </Text>
      </Flex>
    </ModalStandard>
  );
}
