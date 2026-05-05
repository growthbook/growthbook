import { InformationSchemaInterface } from "shared/types/integrations";
import { isManagedWarehouseNoEventsGuidanceMessage } from "shared/util";
import Tooltip from "@/components/Tooltip/Tooltip";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";

export default function RetryInformationSchemaCard({
  informationSchema,
  refreshOrCreateInfoSchema,
  canRunQueries,
  error,
}: {
  informationSchema: InformationSchemaInterface;
  canRunQueries: boolean;
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  error: string | null;
}) {
  const combinedError = error || informationSchema?.error?.message || "";

  return (
    <div>
      {isManagedWarehouseNoEventsGuidanceMessage(combinedError) ? (
        <div className="d-flex flex-column">
          <div className="mb-2">
            <ManagedWarehouseNoEventsCallout />
          </div>
          <div className="d-flex align-items-center">
            <Tooltip
              body="You do not have permission to retry generating an information schema for this datasource."
              shouldDisplay={!canRunQueries}
            >
              <button
                disabled={!canRunQueries}
                className="btn btn-link"
                onClick={async (e) => {
                  e.preventDefault();
                  refreshOrCreateInfoSchema("PUT");
                }}
              >
                Retry
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="alert alert-warning d-flex align-items-center">
          {combinedError ? <span>{combinedError}</span> : null}
          <Tooltip
            body="You do not have permission to retry generating an information schema for this datasource."
            shouldDisplay={!canRunQueries}
          >
            <button
              disabled={!canRunQueries}
              className="btn btn-link"
              onClick={async (e) => {
                e.preventDefault();
                refreshOrCreateInfoSchema("PUT");
              }}
            >
              Retry
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
