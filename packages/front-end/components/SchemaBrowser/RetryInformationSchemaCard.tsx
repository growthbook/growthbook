import { InformationSchemaInterface } from "shared/types/integrations";
import Tooltip from "@/components/Tooltip/Tooltip";

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
  return (
    <div>
      <div className="alert alert-warning d-flex align-items-center">
        {error || informationSchema?.error?.message ? (
          <span>{error || informationSchema?.error?.message}</span>
        ) : null}
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
  );
}
