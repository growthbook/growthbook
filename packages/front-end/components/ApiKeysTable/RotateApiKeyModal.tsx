import { ReactNode, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { ApiKeyInterface } from "shared/types/apikey";
import {
  MaxLifetimeDays,
  previousKeyExpiration,
  ROTATION_GRACE_PRESET_HOURS,
  rotatedExpiration,
} from "shared/api-key-expiration";
import { datetimeWithZone } from "shared/dates";
import CopyableCode from "@/components/Settings/CopyableCode";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import SelectField from "@/components/Forms/SelectField";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

// A secret as the server returns it once, on creation or rotation.
export type IssuedApiKey = {
  key: string;
  expiresAt: string | null;
  // Only from a rotation.
  previousKeyExpiresAt?: string | null;
};

const GRACE_LABELS: Record<number, string> = {
  0: "Immediately",
  1: "After 1 hour",
  24: "After 24 hours",
  168: "After 7 days",
};

export function RotateApiKeyModal({
  apiKey,
  maxLifetimeDays,
  onRotate,
  close,
}: {
  apiKey: ApiKeyInterface;
  maxLifetimeDays: MaxLifetimeDays;
  onRotate: (gracePeriodHours: number) => Promise<void>;
  close: () => void;
}) {
  const [gracePeriodHours, setGracePeriodHours] = useState("24");
  const previousEnd = previousKeyExpiration(
    apiKey.expiresAt,
    parseInt(gracePeriodHours),
  );
  const newExpiry = rotatedExpiration(
    apiKey.expiresAt,
    apiKey.keyIssuedAt ?? apiKey.dateCreated,
    maxLifetimeDays,
  );

  return (
    <ModalStandard
      trackingEventModalType="rotate-api-key"
      open
      header={`Rotate ${apiKey.userId ? "Personal Access Token" : "API Key"}`}
      cta="Rotate"
      ctaColor={gracePeriodHours === "0" ? "red" : "violet"}
      close={close}
      submit={() => onRotate(parseInt(gracePeriodHours))}
    >
      <Text as="p" mb="4">
        &quot;{apiKey.description || apiKey.id}&quot; gets a new secret. Its ID
        and permissions stay the same.
      </Text>
      <Flex direction="column" gap="4">
        <Flex direction="column">
          <SelectField
            label="Current secret stops"
            legacyLabelFormatting={false}
            size="md"
            sort={false}
            isSearchable={false}
            value={gracePeriodHours}
            onChange={setGracePeriodHours}
            options={ROTATION_GRACE_PRESET_HOURS.map((hours) => ({
              value: String(hours),
              label: GRACE_LABELS[hours],
            }))}
          />
          {previousEnd ? (
            <Text size="sm" color="text-mid" mt="1">
              {datetimeWithZone(previousEnd)}
            </Text>
          ) : (
            <HelperText status="warning" size="sm" mt="1">
              Rejected as soon as you rotate
            </HelperText>
          )}
        </Flex>
        <Detail label="Key expires">
          {newExpiry ? datetimeWithZone(newExpiry) : "Never"}
        </Detail>
      </Flex>
    </ModalStandard>
  );
}

export function IssuedApiKeyModal({
  issued,
  close,
}: {
  issued: IssuedApiKey;
  close: () => void;
}) {
  const rotated = issued.previousKeyExpiresAt !== undefined;
  return (
    <ModalStandard
      trackingEventModalType=""
      open
      header={rotated ? "Key Rotated" : "Key Created"}
      close={close}
      closeCta="Done"
      dismissible={false}
      size="lg"
    >
      <Text as="p" mb="2">
        {rotated && "Update your clients to use the new secret. "}
        Save this key somewhere safe. You won&apos;t be able to see it again
        later.
      </Text>
      <CopyableCode value={issued.key} framed />
      <Flex direction="column" gap="4" mt="4">
        {rotated && (
          <Detail label="Previous secret stops">
            {issued.previousKeyExpiresAt
              ? datetimeWithZone(issued.previousKeyExpiresAt)
              : "Stopped"}
          </Detail>
        )}
        <Detail label="Key expires">
          {issued.expiresAt ? datetimeWithZone(issued.expiresAt) : "Never"}
        </Detail>
      </Flex>
    </ModalStandard>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1">
      <Text size="md" weight="semibold">
        {label}
      </Text>
      <Text color="text-mid">{children}</Text>
    </Flex>
  );
}
