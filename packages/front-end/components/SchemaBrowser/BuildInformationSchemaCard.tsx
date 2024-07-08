import Tooltip from "@/components/Tooltip/Tooltip";

export default function BuildInformationSchemaCard({
  refreshOrCreateInfoSchema,
  canRunQueries,
  error,
}: {
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  canRunQueries: boolean;
  error: string | null;
}) {
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
          body="You do not have permission to generate an information schema for this datasource."
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
