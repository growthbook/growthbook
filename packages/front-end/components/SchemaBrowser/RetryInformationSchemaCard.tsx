import { useState } from "react";
import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import { useAuth } from "@/services/auth";

export default function RetryInformationSchemaCard({
  datasourceId,
  setFetching,
  informationSchema,
}: {
  datasourceId: string;
  setFetching: (fetching: boolean) => void;
  informationSchema: InformationSchemaInterface;
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
        method: "PUT",
        body: JSON.stringify({
          informationSchemaId: informationSchema.id,
        }),
      });
      setFetching(true);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="alert alert-warning d-flex align-items-center">
        <div>
          <span>{error ? error : informationSchema.error.message}</span>
        </div>
        <button
          className="btn btn-link"
          onClick={async (e) => {
            e.preventDefault();
            onClick();
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
