import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

export default function BuildTablesCard({
  refreshOrCreateInfoSchema,
  canRunQueries,
  error,
}: {
  refreshOrCreateInfoSchema: (type: "PUT" | "POST") => void;
  canRunQueries: boolean;
  error: string | null;
}) {
  return (
    <>
      <Callout status="info" mt="2">
        Before we can build visualizations, we need to identify what tables are
        available on this Data Source.
        <Tooltip
          body="You do not have permission to generate an information schema for this datasource."
          shouldDisplay={!canRunQueries}
        >
          <Button
            disabled={!canRunQueries}
            className="mt-2"
            onClick={async (e: React.MouseEvent<HTMLButtonElement>) => {
              e.preventDefault();
              refreshOrCreateInfoSchema("POST");
            }}
          >
            <Tooltip
              body="To identify tables, GrowthBook queries your Data Source to build an Information Schema, which tells us what databases, schemas, and tables are available to query."
              shouldDisplay={canRunQueries}
            >
              Identify Tables
            </Tooltip>
          </Button>
        </Tooltip>
      </Callout>
      {error && (
        <Callout status="error" mt="2">
          {error}
        </Callout>
      )}
    </>
  );
}
