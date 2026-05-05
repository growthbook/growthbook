import React, { FC, useCallback, useState } from "react";
import { FaPlus } from "react-icons/fa";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import { EditJupyterNotebookQueryRunner } from "@/components/Settings/EditDataSource/DataSourceJupypterQuery/EditJupyterNotebookQueryRunner";
import Code from "@/components/SyntaxHighlighting/Code";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";

type DataSourceJupyterNotebookQueryProps = DataSourceQueryEditingModalBaseProps;

export const DataSourceJupyterNotebookQuery: FC<
  DataSourceJupyterNotebookQueryProps
> = ({ onSave, dataSource, canEdit = true }) => {
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");
  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const handleCancel = useCallback(() => {
    setUiMode("view");
  }, []);

  if (!dataSource) {
    console.error("ImplementationError: dataSource cannot be null");
    return null;
  }

  return (
    <Box>
      <Flex align="start" justify="between" mb="2">
        <Box>
          <Heading size="4" mb="0">
            Jupyter Notebook Query Runner
          </Heading>
        </Box>

        {canEdit && (
          <Box>
            <Button
              variant={dataSource.settings.notebookRunQuery ? "ghost" : "solid"}
              onClick={() => {
                setUiMode("edit");
              }}
            >
              {dataSource.settings.notebookRunQuery ? (
                <>Edit</>
              ) : (
                <>
                  <FaPlus className="mr-1" /> Add
                </>
              )}
            </Button>
          </Box>
        )}
      </Flex>
      <p>
        Tell us how to query this data source from within a Jupyter notebook
        environment.
      </p>
      {dataSource.settings?.notebookRunQuery ? (
        <Code
          code={dataSource.settings.notebookRunQuery}
          language="python"
          expandable={true}
        />
      ) : (
        <></>
      )}

      {uiMode === "edit" ? (
        <EditJupyterNotebookQueryRunner
          onSave={onSave}
          onCancel={handleCancel}
          dataSource={dataSource}
        />
      ) : null}
    </Box>
  );
};
