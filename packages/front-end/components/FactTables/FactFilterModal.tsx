import {
  CreateFactFilterProps,
  FactFilterInterface,
  FactFilterTestResults,
  FactTableInterface,
  UpdateFactFilterProps,
} from "back-end/types/fact-table";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { FaAngleDown, FaAngleRight, FaPlay } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import Button from "@/components/Button";
import Checkbox from "@/ui/Checkbox";
import { Table, TableBody, TableRow, TableCell } from "@/ui/Table";
import FactTableSchema from "./FactTableSchema";

export interface Props {
  factTable: FactTableInterface;
  existing?: FactFilterInterface;
  close: () => void;
}

export default function FactFilterModal({ existing, factTable, close }: Props) {
  const { apiCall } = useAuth();

  const [showDescription, setShowDescription] = useState(
    !!existing?.description?.length,
  );

  const [testResult, setTestResult] = useState<null | FactFilterTestResults>(
    null,
  );

  const [testBeforeSave, setTestBeforeSave] = useState(true);

  const [showExamples, setShowExamples] = useState(false);

  const { mutateDefinitions } = useDefinitions();

  const form = useForm<CreateFactFilterProps>({
    defaultValues: {
      description: existing?.description || "",
      name: existing?.name || "",
      value: existing?.value || "",
    },
  });

  const isNew = !existing;
  useEffect(() => {
    track(
      isNew ? "View Create Fact Filter Modal" : "View Edit Fact Filter Modal",
    );
  }, [isNew]);

  const testQuery = async (value: string) => {
    setTestResult(null);
    const result = await apiCall<{
      result: FactFilterTestResults;
    }>(`/fact-tables/${factTable.id}/test-filter`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
    setTestResult(result.result);
    return result.result;
  };

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      cta={"Save"}
      size="lg"
      header={existing ? "Edit Filter" : "Add Filter"}
      submit={form.handleSubmit(async (value) => {
        // If they added their own "WHERE" to the start, remove it
        value.value = value.value.replace(/^\s*where\s*/i, "").trim();

        if (!value.value) {
          throw new Error("Cannot leave Filter SQL blank");
        }

        if (testBeforeSave) {
          const result = await testQuery(value.value);
          if (result.error) {
            throw new Error("Fix errors before saving");
          }
        }

        if (existing) {
          const data: UpdateFactFilterProps = {
            description: value.description,
            name: value.name,
            value: value.value,
          };
          await apiCall(`/fact-tables/${factTable.id}/filter/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify(data),
          });
          track("Edit Fact Filter");
        } else {
          await apiCall(`/fact-tables/${factTable.id}/filter`, {
            method: "POST",
            body: JSON.stringify(value),
          });
          track("Create Fact Filter");
        }
        mutateDefinitions();
      })}
      secondaryCTA={
        <Checkbox
          value={testBeforeSave}
          setValue={(v) => setTestBeforeSave(v === true)}
          label="Test before saving"
          mr="5"
        />
      }
    >
      <div className="row">
        <div className="col">
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

          <Field
            label="Filter SQL"
            required
            textarea
            minRows={1}
            helpText={
              <>
                When this filter is added to a metric, this will be inserted
                into the WHERE clause.{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowExamples(!showExamples);
                  }}
                >
                  {showExamples ? "Hide" : "Show"} examples{" "}
                  {showExamples ? <FaAngleDown /> : <FaAngleRight />}
                </a>
              </>
            }
            {...form.register("value")}
          />

          {showExamples && (
            <div className="alert alert-info">
              <div className="mb-2">Here are some examples of Filter SQL:</div>
              <Table variant="standard">
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <InlineCode code={`status = 'active'`} language="sql" />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <InlineCode
                        code={`discount > 0 AND coupon IS NOT NULL`}
                        language="sql"
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <InlineCode
                        code={`country IN ('US','CA','UK')`}
                        language="sql"
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          <Button
            color="primary"
            className="btn-sm mr-4"
            onClick={async () => {
              await testQuery(form.watch("value"));
            }}
          >
            <span className="pr-2">
              <FaPlay />
            </span>
            Test Query
          </Button>
        </div>
        {factTable.columns?.some((col) => !col.deleted) ? (
          <div className="col-auto border-left">
            <div className="mb-3">
              <label>Available Columns</label>
              <FactTableSchema factTable={factTable} />
            </div>
          </div>
        ) : null}
      </div>
      {testResult ? (
        <div className="border-top mt-3 pt-2">
          <DisplayTestQueryResults
            duration={testResult.duration || 0}
            results={testResult.results || []}
            sql={testResult.sql || ""}
            error={testResult.error || ""}
            close={() => setTestResult(null)}
            expandable={true}
          />
        </div>
      ) : null}
    </Modal>
  );
}
