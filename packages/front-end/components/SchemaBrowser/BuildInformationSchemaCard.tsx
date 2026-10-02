import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

export default function BuildInformationSchemaCard({
  refreshOrCreateInfoSchema,
  canRunQueries,
  error,
  size = "md",
}: {
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  canRunQueries: boolean;
  error: string | null;
  size?: "sm" | "md";
}) {
  return (
    <div>
      <Callout
        status="info"
        size={size}
        action={
          <Tooltip
            body="You don't have permission to load tables for this Data Source."
            shouldDisplay={!canRunQueries}
          >
            <Button
              color="inherit"
              size={size}
              disabled={!canRunQueries}
              onClick={() => refreshOrCreateInfoSchema("POST")}
            >
              Load tables
            </Button>
          </Tooltip>
        }
      >
        No tables loaded yet.
      </Callout>
      {error && (
        <Callout status="error" size={size}>
          {error}
        </Callout>
      )}
    </div>
  );
}
