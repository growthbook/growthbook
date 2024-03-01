import { InformationSchemaInterface } from "@back-end/src/types/Integration";

export default function RetryInformationSchemaCard({
  informationSchema,
  refreshOrCreateInfoSchema,
  error,
}: {
  informationSchema: InformationSchemaInterface;
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  error: string | null;
}) {
  return (
    <div>
      <div className="alert alert-warning d-flex align-items-center">
        {error || informationSchema?.error?.message ? (
          <span>{error || informationSchema?.error?.message}</span>
        ) : null}
        <button
          className="btn btn-link"
          onClick={async (e) => {
            e.preventDefault();
            refreshOrCreateInfoSchema("PUT");
          }}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
