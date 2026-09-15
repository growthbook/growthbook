import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

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
      <Callout
        status="info"
        action={
          <Tooltip
            body="You do not have permission to generate an information schema for this datasource."
            shouldDisplay={!canRunQueries}
          >
            <Button
              color="inherit"
              disabled={!canRunQueries}
              onClick={() => refreshOrCreateInfoSchema("POST")}
            >
              Generate Information Schema
            </Button>
          </Tooltip>
        }
      >
        Need help building your query? Click the button to get insight into what
        tables and columns are available in the datasource.
      </Callout>
      {error && <Callout status="error">{error}</Callout>}
    </div>
  );
}
