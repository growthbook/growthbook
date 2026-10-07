import { FC } from "react";
import { ago, datetime } from "shared/dates";
import {
  ExpiresAt,
  getExpirationStatus,
  MaxLifetimeDays,
  violatesExpirationPolicy,
} from "shared/api-key-expiration";
import { Flex } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";

/**
 * Expired reads as "won't authenticate" just like Disabled, but only one of the
 * two is fixed by re-enabling, so they stay visually distinct.
 */
const ExpiresCell: FC<{
  expiresAt: ExpiresAt;
  maxLifetimeDays?: MaxLifetimeDays;
}> = ({ expiresAt, maxLifetimeDays }) => {
  if (!violatesExpirationPolicy(expiresAt, maxLifetimeDays)) {
    return <ExpiryText expiresAt={expiresAt} />;
  }
  // Pairs with the policy row's "N non-compliant" count, so admins can find them.
  return (
    <Flex align="center" gap="2">
      <ExpiryText expiresAt={expiresAt} />
      <Tooltip
        content={`Your organization requires an expiration date within ${maxLifetimeDays} days.`}
      >
        <span>
          <Badge color="amber" variant="soft" label="Non-compliant" />
        </span>
      </Tooltip>
    </Flex>
  );
};

const ExpiryText: FC<{ expiresAt: ExpiresAt }> = ({ expiresAt }) => {
  const status = getExpirationStatus(expiresAt);

  if (status === "none") {
    return <Text color="text-low">Never</Text>;
  }
  if (status === "expired") {
    return (
      <Tooltip content={`Expired ${datetime(expiresAt as string | Date)}`}>
        <span>
          <Badge color="red" variant="soft" label="Expired" />
        </span>
      </Tooltip>
    );
  }
  if (status === "expiring-soon") {
    return (
      <Tooltip content={datetime(expiresAt as string | Date)}>
        <span>
          <Badge
            color="amber"
            variant="soft"
            label={`Expires ${ago(expiresAt as string | Date)}`}
          />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={datetime(expiresAt as string | Date)}>
      <span>{ago(expiresAt as string | Date)}</span>
    </Tooltip>
  );
};

export default ExpiresCell;
