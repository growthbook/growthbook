import { InformationSchemaInterface } from "@back-end/src/types/Integration";
import { DataSourceInterfaceWithParams } from "@back-end/types/datasource";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function RetryInformationSchemaCard({
  informationSchema,
  refreshOrCreateInfoSchema,
  datasource,
  error,
}: {
  informationSchema: InformationSchemaInterface;
  datasource: DataSourceInterfaceWithParams;
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  error: string | null;
}) {
  const permissionsUtil = usePermissionsUtil();
  const canRunQueries = permissionsUtil.canRunSchemaQueries(datasource);
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
