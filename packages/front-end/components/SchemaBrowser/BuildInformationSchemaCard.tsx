export default function BuildInformationSchemaCard({
  refreshOrCreateInfoSchema,
  error,
}: {
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
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
        <button
          className="mt-2 btn btn-primary"
          onClick={async (e) => {
            e.preventDefault();
            refreshOrCreateInfoSchema("POST");
          }}
        >
          Generate Information Schema
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
