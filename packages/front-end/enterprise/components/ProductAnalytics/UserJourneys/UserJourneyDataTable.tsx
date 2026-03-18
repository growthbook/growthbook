import type { QueryInterface } from "shared/types/query";
import type { UserJourneyPathRow } from "shared/validators";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";

export default function UserJourneyDataTable({
  rows,
  error,
  query,
}: {
  rows: UserJourneyPathRow[];
  error: string | null;
  query: QueryInterface | null;
}) {
  return (
    <DisplayTestQueryResults
      results={rows as Record<string, unknown>[]}
      duration={query?.statistics?.executionDurationMs ?? 0}
      sql={query?.query || ""}
      error={error || ""}
      allowDownload={true}
      showSampleHeader={false}
      showDuration={!!query?.statistics}
      showNoRowsWarning={true}
    />
  );
}
