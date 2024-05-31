import React, { useState } from "react";
import { useRouter } from "next/router";
import {
  SavedGroupInterface,
  UpdateSavedGroupProps,
} from "back-end/types/saved-group";
import { FaCheck, FaMinusCircle } from "react-icons/fa";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import useMembers from "@/hooks/useMembers";
import { useAttributeSchema } from "@/services/features";
import PageHead from "@/components/Layout/PageHead";
import Pagination from "@/components/Pagination";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

const NUM_PER_PAGE = 20;

interface EmptyStateProps {
  values: string[];
  setValues: (values: string[]) => void;
}

function EmptyState({ values, setValues }: EmptyStateProps) {
  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [importMethod, setImportMethod] = useState<null | "file" | "values">(
    null
  );
  const [successText, setSuccessText] = useState("");

  return (
    <>
      <div>How would you like to enter the IDs in this group?</div>
      <button onClick={() => setImportMethod("file")}>Import CSV</button>
      <button onClick={() => setImportMethod("values")}>
        Enter values manually
      </button>
      {importMethod === "file" && (
        <>
          <div className="custom-file">
            <input
              type="file"
              required={false}
              className="custom-file-input"
              id="savedGroupFileInput"
              accept=".csv"
              onChange={(e) => {
                setSuccessText("");
                const file: File | undefined = e.target?.files?.[0];
                if (!file) {
                  return;
                }

                const reader = new FileReader();
                reader.onload = function (e) {
                  try {
                    const str = e.target?.result;
                    if (typeof str !== "string") {
                      return;
                    }
                    const values = str.split(/\s*,\s*/);
                    setValues(values);
                    setSuccessText(`${values.length} IDs ready to import`);
                  } catch (e) {
                    console.error(e);
                    return;
                  }
                };
                reader.readAsText(file);
              }}
            />
            <label className="custom-file-label" htmlFor="savedGroupFileInput">
              Upload CSV with ids to include...
            </label>
            {successText ? (
              <>
                <FaCheck /> {successText}
              </>
            ) : (
              <></>
            )}
          </div>
        </>
      )}
      {importMethod === "values" && (
        <>
          {rawTextMode ? (
            <Field
              containerClassName="mb-0"
              label="Create list of comma separated values"
              required
              textarea
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value);
                setValues(e.target.value.split(",").map((val) => val.trim()));
              }}
            />
          ) : (
            <StringArrayField
              containerClassName="mb-0"
              label="Create list of values"
              value={values}
              onChange={(values) => {
                setValues(values);
                setRawText(values.join(","));
              }}
              placeholder="Enter some values..."
              delimiters={["Enter", "Tab"]}
            />
          )}
          <a
            className="d-flex flex-column align-items-end"
            href="#"
            style={{ fontSize: "0.8em" }}
            onClick={(e) => {
              e.preventDefault();
              setRawTextMode((prev) => !prev);
            }}
          >
            Switch to {rawTextMode ? "token" : "raw text"} mode
          </a>
        </>
      )}
    </>
  );
}

export default function EditSavedGroupPage() {
  const router = useRouter();
  const { sgid } = router.query;
  const { data, error, mutate } = useApi<{ savedGroup: SavedGroupInterface }>(
    `/saved-groups/${sgid}`
  );
  const savedGroup = data?.savedGroup;

  const values = savedGroup?.values || [];
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState("");
  const filteredValues = values.filter((v) => v.match(filter));

  const { apiCall } = useAuth();
  const { memberUsernameOptions } = useMembers();

  const attributeSchema = useAttributeSchema();

  const start = (currentPage - 1) * NUM_PER_PAGE;
  const end = start + NUM_PER_PAGE;
  const valuesPage = filteredValues.slice(start, end);

  const [groupName, setGroupName] = useState(savedGroup?.groupName || "");
  const [owner, setOwner] = useState(savedGroup?.owner || "");

  if (!savedGroup || savedGroup.type !== "list" || error) {
    return (
      <div className="alert alert-danger">
        There was an error loading the saved group.
      </div>
    );
  }
  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Saved Groups", href: "/saved-groups" },
          { display: savedGroup.groupName },
        ]}
      />
      <div className="p-3 container-fluid pagecontents">
        <div className="alert alert-warning mt-2">
          <b>Warning:</b> Updating this group will automatically update any
          feature or experiment that references it.
        </div>
        <Field
          label="Group Name"
          required
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="e.g. beta-users or internal-team-members"
        />
        {savedGroup.id && (
          <SelectField
            label="Owner"
            value={owner}
            onChange={(v) => setOwner(v)}
            placeholder="Optional"
            options={memberUsernameOptions.map((m) => ({
              value: m.display,
              label: m.display,
            }))}
          />
        )}
        <SelectField
          label="Attribute Key"
          required={false}
          value={savedGroup.attributeKey || ""}
          disabled={true}
          onChange={() => {}}
          options={attributeSchema.map((a) => ({
            value: a.property,
            label: a.property,
          }))}
          helpText="This field can not be edited."
        />
        <button
          onClick={async () => {
            const payload: UpdateSavedGroupProps = {
              groupName: savedGroup.groupName,
              owner: savedGroup.owner,
            };
            mutate({
              savedGroup: {
                ...savedGroup,
                ...{ groupName, owner },
              },
            });
            await apiCall(`/saved-groups/${savedGroup.id}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
          }}
        >
          Save changes
        </button>
        {values.length > 0 ? (
          <>
            <div>Group Members</div>
            <div className="row mb-2 align-items-center">
              <div className="col-auto">
                <Field
                  placeholder="Search..."
                  type="search"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                  }}
                />
              </div>
              <div className="col-auto">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    apiCall(`/saved-groups/${sgid}/add-member/5`, {
                      method: "POST",
                    });
                    mutate({
                      savedGroup: {
                        ...savedGroup,
                        values: (savedGroup.values || []).concat(["5"]),
                      },
                    });
                  }}
                >
                  Add member
                </button>
              </div>
            </div>

            <table className="table gbtable table-hover appbox">
              <thead
                className="sticky-top bg-white shadow-sm"
                style={{ top: "56px", zIndex: 900 }}
              >
                <tr>
                  <th>{savedGroup.attributeKey}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {valuesPage.map((value) => {
                  return (
                    <tr key={value}>
                      <td>{value}</td>
                      <td>
                        <FaMinusCircle
                          onClick={(e) => {
                            e.preventDefault();
                            apiCall(
                              `/saved-groups/${sgid}/remove-member/${value}`,
                              { method: "POST" }
                            );
                            const newValues = (savedGroup.values || []).slice();
                            const index = newValues.indexOf(value);
                            if (index !== -1) {
                              newValues.splice(index, 1);
                            }
                            mutate({
                              savedGroup: {
                                ...savedGroup,
                                values: newValues,
                              },
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
                {!filteredValues.length && (
                  <tr>
                    <td colSpan={2}>No matching members</td>
                  </tr>
                )}
              </tbody>
            </table>
            {Math.ceil(filteredValues.length / NUM_PER_PAGE) > 1 && (
              <Pagination
                numItemsTotal={values.length}
                currentPage={currentPage}
                perPage={NUM_PER_PAGE}
                onPageChange={(d) => {
                  setCurrentPage(d);
                }}
              />
            )}
          </>
        ) : (
          <EmptyState
            values={values}
            setValues={(values) => {
              // TODO: import values
              console.log(values);
            }}
          />
        )}
      </div>
    </>
  );
}
