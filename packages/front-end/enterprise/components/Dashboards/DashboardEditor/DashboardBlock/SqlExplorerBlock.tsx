import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { useState } from "react";
import { PiPencil, PiPlus } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import Button from "@/components/Radix/Button";
import SqlExplorerDataVisualization from "@/components/DataViz/SqlExplorerDataVisualization";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/components/Radix/Callout";
import SelectField from "@/components/Forms/SelectField";
import { BlockProps } from ".";

export default function SqlExplorerBlock({
  savedQueryId,
  dataVizConfigIndex,
  isEditing,
  setBlock,
}: BlockProps<SqlExplorerBlockInterface>) {
  const { data, mutate: mutateQuery, isLoading } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const [showModal, setShowModal] = useState(false);

  if (isLoading) return <LoadingSpinner />;
  if (!data?.savedQueries)
    return (
      <Callout status="error">
        Failed to load saved queries, try again later
      </Callout>
    );
  const savedQueryOptions = data.savedQueries.map(({ id, name }) => ({
    value: id,
    label: name,
  }));
  const savedQuery = data.savedQueries.find(
    (q: SavedQuery) => q.id === savedQueryId
  );
  const dataVizConfig = savedQuery?.dataVizConfig?.[dataVizConfigIndex];
  return (
    <div>
      {showModal && (
        <SqlExplorerModal
          close={() => {
            setShowModal(false);
          }}
          mutate={mutateQuery}
          initial={savedQuery}
        />
      )}
      {isEditing && (
        <>
          <Flex align="center" justify="between">
            <Flex flexGrow="1" gap="1">
              <SelectField
                value={savedQueryId || ""}
                placeholder="Choose a saved query"
                options={savedQueryOptions}
                onChange={(val) =>
                  setBlock({
                    type: "sql-explorer",
                    savedQueryId: val,
                    dataVizConfigIndex: 0,
                  })
                }
                isClearable
              />
              {savedQuery && (
                <SelectField
                  value={dataVizConfigIndex.toString()}
                  placeholder="Choose a data visualization to display"
                  disabled={(savedQuery.dataVizConfig?.length || 0) === 0}
                  options={(savedQuery.dataVizConfig || []).map(
                    ({ title }, i) => ({
                      label: title || `Visualization ${i}`,
                      value: i.toString(),
                    })
                  )}
                  onChange={(value) =>
                    setBlock({
                      type: "sql-explorer",
                      savedQueryId,
                      dataVizConfigIndex: parseInt(value),
                    })
                  }
                />
              )}
            </Flex>
            <Button
              onClick={() => setShowModal(true)}
              icon={savedQueryId ? <PiPencil /> : <PiPlus />}
            >
              {savedQueryId ? "Edit" : "New Query"}
            </Button>
          </Flex>
        </>
      )}
      {savedQuery && dataVizConfig && (
        <SqlExplorerDataVisualization
          rows={savedQuery.results.results}
          dataVizConfig={dataVizConfig}
          onDataVizConfigChange={() => {}}
          showPanel={false}
        />
      )}
    </div>
  );
}
