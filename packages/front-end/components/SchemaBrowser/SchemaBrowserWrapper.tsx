import { InformationSchemaInterface } from "shared/types/integrations";
import { PiArrowClockwise, PiDatabase } from "react-icons/pi";
import { Box, IconButton } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";
import AreaWithHeader from "./AreaWithHeader";

export default function SchemaBrowserWrapper({
  children,
  datasourceName,
  datasourceId,
  informationSchema,
  canRunQueries,
  setFetching,
  setError,
  fetching,
  tableFilter,
  onTableFilterChange,
}: {
  children: React.ReactNode;
  datasourceName: string;
  datasourceId: string;
  informationSchema?: InformationSchemaInterface;
  setError: (error: string | null) => void;
  setFetching: (fetching: boolean) => void;
  canRunQueries: boolean;
  fetching: boolean;
  tableFilter: string;
  onTableFilterChange: (value: string) => void;
}) {
  const { apiCall } = useAuth();

  return (
    <AreaWithHeader
      backgroundColor="var(--color-surface)"
      header={
        <>
          <div className="d-flex justify-content-between px-2">
            <label className="font-weight-bold mb-1 d-flex align-items-center">
              <PiDatabase className="mr-2" />
              <span className="pl-1">{datasourceName}</span>
            </label>
            {informationSchema && !informationSchema.error && (
              <div className="d-flex align-items-center pl-5">
                <label className="ml-3 mb-0">
                  <Tooltip
                    body={
                      <div>
                        <div>
                          {`Last Updated: ${new Date(
                            informationSchema.dateUpdated,
                          ).toLocaleString()}`}
                        </div>
                        {!canRunQueries ? (
                          <Callout status="warning" size="sm" mt="2">
                            You don&apos;t have permission to load tables for
                            this Data Source.
                          </Callout>
                        ) : null}
                      </div>
                    }
                    tipPosition="top"
                    style={{ display: "flex" }}
                  >
                    <IconButton
                      type="button"
                      variant="ghost"
                      color="gray"
                      size="1"
                      aria-label="Refresh tables"
                      disabled={fetching || !canRunQueries}
                      onClick={async () => {
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
                      }}
                    >
                      {fetching ? <LoadingSpinner /> : <PiArrowClockwise />}
                    </IconButton>
                  </Tooltip>
                </label>
              </div>
            )}
          </div>
          {informationSchema && !informationSchema.error && (
            <Box mt="1">
              <Field
                size="legacy"
                type="search"
                value={tableFilter}
                onChange={(e) => onTableFilterChange(e.target.value)}
                placeholder="Search..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                  }
                }}
              />
            </Box>
          )}
        </>
      }
    >
      {children}
    </AreaWithHeader>
  );
}
