import { FC } from "react";
import { useForm } from "react-hook-form";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import { DataSourceQueryEditingModalBaseProps } from "../types";

type EditJupyterNotebookQueryRunnerProps = DataSourceQueryEditingModalBaseProps;

export const EditJupyterNotebookQueryRunner: FC<EditJupyterNotebookQueryRunnerProps> = ({
  dataSource,
  onSave,
  onCancel,
}) => {
  if (!dataSource) {
    throw new Error("ImplementationError: dataSource cannot be null");
  }

  const form = useForm({
    defaultValues: {
      query: dataSource.settings.notebookRunQuery || "",
    },
  });

  const handleSubmit = form.handleSubmit(async (value) => {
    const copy = cloneDeep<DataSourceInterfaceWithParams>(dataSource);
    copy.settings.notebookRunQuery = value.query;
    await onSave(copy);
  });

  return (
    <Modal
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="max"
      header="Edit Jupyter Notebook Query Runner"
      cta="Save"
    >
      <h4>Jupyter Notebook Query Runner (optional)</h4>
      <div className="bg-light border my-2 p-3 ml-3">
        <div className="row mb-3">
          <div className="col">
            <CodeTextArea
              label="Python runQuery definition"
              language="python"
              placeholder="def runQuery(sql):"
              value={form.watch("query")}
              setValue={(python) => form.setValue("query", python)}
              helpText="Used when exporting experiment results to a Jupyter notebook"
            />
          </div>
          <div className="col-md-5 col-lg-4">
            <div className="pt-md-4">
              Function definition:
              <ul>
                <li>
                  Function name: <code>runQuery</code>
                </li>
                <li>
                  Arguments: <code>sql</code> (string)
                </li>
                <li>
                  Return: <code>df</code> (pandas data frame)
                </li>
              </ul>
              <p>Example for postgres/redshift:</p>
              <Code
                language="python"
                code={`import os
import psycopg2
import pandas as pd
from sqlalchemy import create_engine, text

# Use env variables or similar for passwords!
password = os.getenv('POSTGRES_PW')
connStr = f'postgresql+psycopg2://user:{password}@localhost'
dbConnection = create_engine(connStr).connect();

def runQuery(sql):
  return pd.read_sql(text(sql), dbConnection)`}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
