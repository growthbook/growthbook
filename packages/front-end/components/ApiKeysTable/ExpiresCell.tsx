import { FC } from "react";
import { ago, datetime } from "shared/dates";
import { ExpiresAt, getExpirationStatus } from "shared/api-key-expiration";
import Tooltip from "@/ui/Tooltip";
import Badge from "@/ui/Badge";

/**
 * Expired reads as "won't authenticate" just like Disabled, but only one of the
 * two is fixed by re-enabling, so they stay visually distinct.
 */
const ExpiresCell: FC<{ expiresAt: ExpiresAt }> = ({ expiresAt }) => {
  const status = getExpirationStatus(expiresAt);

  if (status === "none") {
    return <span className="text-muted">Never</span>;
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
