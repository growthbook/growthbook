import { DataSourceInterfaceWithParams } from "@back-end/types/datasource";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function BuildInformationSchemaCard({
  refreshOrCreateInfoSchema,
  datasource,
  error,
}: {
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  datasource: DataSourceInterfaceWithParams;
  error: string | null;
}) {
  const permissionsUtil = usePermissionsUtil();
  const canRunQueries = permissionsUtil.canRunSchemaQueries(datasource);
  return (
    <div>
      <div className="alert alert-info">
        <div>
          <span>
            Need help building your query? Click the button below to get insight
            into what tables and columns are available in the datasource.
          </span>
        </div>
        <Tooltip
          body="You don't have permission to run this query."
          shouldDisplay={!canRunQueries}
        >
          <button
            disabled={!canRunQueries}
            className="mt-2 btn btn-primary"
            onClick={async (e) => {
              e.preventDefault();
              refreshOrCreateInfoSchema("POST");
            }}
          >
            Generate Information Schema
          </button>
        </Tooltip>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
