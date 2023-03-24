import { useState } from "react";
import { useAuth } from "@/services/auth";

export default function BuildInformationSchemaCard({
  datasourceId,
  setFetching,
}: {
  datasourceId: string;
  setFetching: (fetching: boolean) => void;
}) {
  const [error, setError] = useState<null | string>(null);
  const { apiCall } = useAuth();

  async function onClick() {
    setError(null);
    try {
      await apiCall<{
        status: number;
        message?: string;
      }>(`/datasource/${datasourceId}/schema`, {
        method: "POST",
      });
      setFetching(true);
    } catch (e) {
      setFetching(false);
      setError(e.message);
    }
  }

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
            onClick();
          }}
        >
          Generate Information Schema
        </button>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
    </div>
  );
}
