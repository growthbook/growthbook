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
      <Text as="p" mb="2">
        Update your clients to use the new secret.
      </Text>
      <CopyableCode value={rotated.key} />
      <Flex direction="column" gap="4" mt="4">
        <Detail label="Previous secret stops">
          {rotated.previousKeyExpiresAt
            ? datetimeWithZone(rotated.previousKeyExpiresAt)
            : "Stopped"}
        </Detail>
        <Detail label="Key expires">
          {rotated.expiresAt ? datetimeWithZone(rotated.expiresAt) : "Never"}
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
