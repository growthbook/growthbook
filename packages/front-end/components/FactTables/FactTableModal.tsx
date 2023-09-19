import {
  CreateFactTableProps,
  FactTableInterface,
  UpdateFactTableProps,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useRouter } from "next/router";
import { isProjectListValidForProject } from "shared/util";
import { useState } from "react";
import { FaExternalLinkAlt } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import { getNewExperimentDatasourceDefaults } from "../Experiment/NewExperimentForm";
import MarkdownInput from "../Markdown/MarkdownInput";
import MultiSelectField from "../Forms/MultiSelectField";
import EditSqlModal from "../SchemaBrowser/EditSqlModal";
import Code from "../SyntaxHighlighting/Code";

export interface Props {
  existing?: FactTableInterface;
  close: () => void;
}

export default function FactTableModal({ existing, close }: Props) {
  const {
    datasources,
    project,
    getDatasourceById,
    mutateDefinitions,
  } = useDefinitions();
  const settings = useOrgSettings();
  const router = useRouter();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length
  );

  const [sqlOpen, setSqlOpen] = useState(false);

  const { apiCall } = useAuth();

  const form = useForm<CreateFactTableProps>({
    defaultValues: {
      datasource:
        existing?.datasource ||
        getNewExperimentDatasourceDefaults(datasources, settings, project)
          .datasource,
      description: existing?.description || "",
      name: existing?.name || "",
      sql: existing?.sql || "",
      userIdTypes: existing?.userIdTypes || [],
    },
  });

  const validDatasources = datasources.filter((d) =>
    isProjectListValidForProject(d.projects, project)
  );

  const selectedDataSource = getDatasourceById(form.watch("datasource"));

  return (
    <>
      {sqlOpen && (
        <EditSqlModal
          close={() => setSqlOpen(false)}
          datasourceId={form.watch("datasource")}
          placeholder={
            "SELECT\n      user_id as user_id, timestamp as timestamp\nFROM\n      test"
          }
          requiredColumns={new Set(["timestamp", ...form.watch("userIdTypes")])}
          value={form.watch("sql")}
          save={async (sql) => {
            form.setValue("sql", sql);
          }}
        />
      )}
      <Modal
        open={true}
        close={close}
        cta={"Save"}
        header={existing ? "Edit Fact Table" : "Create Fact Table"}
        submit={form.handleSubmit(async (value) => {
          if (!value.userIdTypes.length) {
            throw new Error("Must select at least one identifier type");
          }

          if (!value.sql) {
            throw new Error("Must add a SQL query");
          }

          if (existing) {
            const data: UpdateFactTableProps = {
              description: value.description,
              name: value.name,
              sql: value.sql,
              userIdTypes: value.userIdTypes,
            };
            await apiCall(`/fact-tables/${existing.id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
            await mutateDefinitions();
          } else {
            const ds = getDatasourceById(value.datasource);
            if (!ds) throw new Error("Must select a valid data source");

            value.projects = ds.projects || [];

            const { factTable, error } = await apiCall<{
              factTable: FactTableInterface;
              error?: string;
            }>(`/fact-tables`, {
              method: "POST",
              body: JSON.stringify(value),
            });

            if (error) {
              throw new Error(error);
            }

            await mutateDefinitions();
            router.push(`/fact-tables/${factTable.id}`);
          }
        })}
      >
        <Field label="Name" {...form.register("name")} required />

        {showDescription ? (
          <div className="form-group">
            <label>Description</label>
            <MarkdownInput
              value={form.watch("description")}
              setValue={(value) => form.setValue("description", value)}
              autofocus={!existing?.description?.length}
            />
          </div>
        ) : (
          <a
            href="#"
            className="badge badge-light badge-pill mb-3"
            onClick={(e) => {
              e.preventDefault();
              setShowDescription(true);
            }}
          >
            + description
          </a>
        )}
        {!existing && (
          <SelectField
            label="Data Source"
            value={form.watch("datasource")}
            onChange={(v) => {
              form.setValue("datasource", v);
            }}
            options={validDatasources.map((d) => {
              const defaultDatasource = d.id === settings.defaultDataSource;
              return {
                value: d.id,
                label: `${d.name}${
                  d.description ? ` — ${d.description}` : ""
                } ${defaultDatasource ? " (default)" : ""}`,
              };
            })}
            className="portal-overflow-ellipsis"
            name="datasource"
            placeholder="Select..."
          />
        )}

        {selectedDataSource && (
          <MultiSelectField
            value={form.watch("userIdTypes")}
            onChange={(types) => {
              form.setValue("userIdTypes", types);
            }}
            options={(selectedDataSource.settings.userIdTypes || []).map(
              ({ userIdType }) => ({
                value: userIdType,
                label: userIdType,
              })
            )}
            label="Identifier Types Supported"
          />
        )}

        {selectedDataSource && (
          <div className="form-group">
            <label>Query</label>
            {form.watch("sql") && (
              <Code language="sql" code={form.watch("sql")} expandable={true} />
            )}
            <div>
              <button
                className="btn btn-outline-primary"
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setSqlOpen(true);
                }}
              >
                {form.watch("sql") ? "Edit" : "Add"} SQL <FaExternalLinkAlt />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
