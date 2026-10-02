import { InformationSchemaInterface } from "shared/types/integrations";
import { isManagedWarehouseNoEventsGuidanceMessage } from "shared/util";
import { Flex } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

export default function RetryInformationSchemaCard({
  informationSchema,
  refreshOrCreateInfoSchema,
  canRunQueries,
  error,
  size = "md",
}: {
  informationSchema: InformationSchemaInterface;
  canRunQueries: boolean;
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  error: string | null;
  size?: "sm" | "md";
}) {
  const combinedError = error || informationSchema?.error?.message || "";

  return (
    <div>
      {isManagedWarehouseNoEventsGuidanceMessage(combinedError) ? (
        <Flex direction="column" gap="2">
          <ManagedWarehouseNoEventsCallout size={size} />
          <Tooltip
            body="You don't have permission to load tables for this Data Source."
            shouldDisplay={!canRunQueries}
          >
            <Button
              variant="ghost"
              size={size}
              disabled={!canRunQueries}
              onClick={() => refreshOrCreateInfoSchema("PUT")}
            >
              Retry
            </Button>
          </Tooltip>
        </Flex>
      ) : (
        <Callout
          status="warning"
          size={size}
          action={
            <Tooltip
              body="You don't have permission to load tables for this Data Source."
              shouldDisplay={!canRunQueries}
            >
              <Button
                color="inherit"
                size={size}
                disabled={!canRunQueries}
                onClick={() => refreshOrCreateInfoSchema("PUT")}
              >
                Retry
              </Button>
            </Tooltip>
          }
        >
          {combinedError}
        </Callout>
      )}
    </div>
  );
}
