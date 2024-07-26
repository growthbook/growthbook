import { FC, useEffect, useState } from "react";
import {
  LARGE_GROUP_SIZE_LIMIT_BYTES,
  SMALL_GROUP_SIZE_LIMIT,
} from "shared/util";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaRetweet,
} from "react-icons/fa";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import StringArrayField from "@/components/Forms/StringArrayField";
import LargeSavedGroupSupportWarning, {
  useLargeSavedGroupSupport,
} from "./LargeSavedGroupSupportWarning";

export const IdListItemInput: FC<{
  values: string[];
  passByReferenceOnly: boolean;
  // Allow for grandfathering in existing large lists
  bypassSmallListSizeLimit: boolean;
  groupReferencedByUnsupportedSdks: boolean;
  limit?: number;
  setValues: (newValues: string[]) => void;
  setPassByReferenceOnly: (passByReferenceOnly: boolean) => void;
  disableSubmit: boolean;
  setDisableSubmit: (disabled: boolean) => void;
  openUpgradeModal?: () => void;
}> = ({
  values,
  passByReferenceOnly,
  bypassSmallListSizeLimit,
  groupReferencedByUnsupportedSdks,
  limit = SMALL_GROUP_SIZE_LIMIT,
  setValues,
  setPassByReferenceOnly,
  disableSubmit,
  setDisableSubmit,
  openUpgradeModal,
}) => {
  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState(values.join(", ") || "");
  useEffect(() => {
    setRawText(values.join(","));
  }, [values]);

  const [importMethod, setImportMethod] = useState<"file" | "values">("file");
  const [numValuesToImport, setNumValuesToImport] = useState<number | null>(
    null
  );
  const [fileName, setFileName] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const {
    supportedConnections,
    unsupportedConnections,
    unversionedConnections,
    hasLargeSavedGroupFeature,
  } = useLargeSavedGroupSupport();

  const resetFile = () => {
    setValues([]);
    setNumValuesToImport(null);
    setFileName("");
    setFileErrorMessage("");
    setNonLegacyImport(false);
  };

  const [nonLegacyImport, setNonLegacyImport] = useState(false);

  useEffect(() => {
    if (values.length > limit && !bypassSmallListSizeLimit) {
      setNonLegacyImport(true);
      setPassByReferenceOnly(true);
    } else {
      setNonLegacyImport(false);
      setPassByReferenceOnly(false);
    }
  }, [values, limit, bypassSmallListSizeLimit, setPassByReferenceOnly]);

  useEffect(() => {
    if (supportedConnections.length > 0) {
      setDisableSubmit(false);
    } else if (
      nonLegacyImport &&
      !passByReferenceOnly &&
      !bypassSmallListSizeLimit
    ) {
      setDisableSubmit(true);
    } else {
      setDisableSubmit(false);
    }
  }, [
    setDisableSubmit,
    supportedConnections,
    nonLegacyImport,
    passByReferenceOnly,
    bypassSmallListSizeLimit,
  ]);

  return (
    <>
      <label className="form-group font-weight-bold">
        Choose how to enter items for this list:
      </label>
      <div className="row ml-0 mr-0 form-group">
        <div className="cursor-pointer row align-items-center ml-0 mr-5">
          <input
            type="radio"
            id="importCsv"
            checked={importMethod === "file"}
            readOnly={true}
            className="mr-1 radio-button-lg"
            onChange={() => {
              setImportMethod("file");
            }}
          />
          <label className="m-0" htmlFor="importCsv">
            Import CSV
          </label>
        </div>
        <div className="cursor-pointer row align-items-center ml-0 mr-0">
          <input
            type="radio"
            id="enterValues"
            checked={importMethod === "values"}
            readOnly={true}
            className="mr-1 radio-button-lg"
            onChange={() => {
              setImportMethod("values");
            }}
          />
          <label className="m-0" htmlFor="enterValues">
            Manually enter values
          </label>
        </div>
      </div>
      {!passByReferenceOnly && !bypassSmallListSizeLimit && (
        <LargeSavedGroupSupportWarning
          type={
            groupReferencedByUnsupportedSdks
              ? "in_use_saved_group"
              : "saved_group_creation"
          }
          openUpgradeModal={openUpgradeModal}
          hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
          supportedConnections={supportedConnections}
          unsupportedConnections={unsupportedConnections}
          unversionedConnections={unversionedConnections}
          upgradeWarningToError={disableSubmit}
        />
      )}
      {importMethod === "file" && (
        <>
          <div
            className="custom-file height:"
            onClick={(e) => {
              if (fileName) {
                e.stopPropagation();
                e.preventDefault();
                resetFile();
              }
            }}
          >
            <input
              type="file"
              key={fileName}
              required={false}
              className="custom-file-input cursor-pointer"
              id="savedGroupFileInput"
              accept=".csv"
              onChange={(e) => {
                resetFile();

                const file: File | undefined = e.target?.files?.[0];
                if (!file) {
                  return;
                }
                if (!file.name.endsWith(".csv")) {
                  setFileErrorMessage("Only .csv file types are supported");
                  return;
                }
                if (file.size > LARGE_GROUP_SIZE_LIMIT_BYTES) {
                  setFileErrorMessage("File size must be less than 1 MB");
                  return;
                }

                const reader = new FileReader();
                reader.onload = function (e) {
                  try {
                    const str = e.target?.result;
                    if (typeof str !== "string") {
                      setFileErrorMessage(
                        "Failed to import file. Please try again"
                      );
                      return;
                    }
                    const newValues = str.replaceAll(/[\n\s]/g, "").split(",");
                    setFileName(file.name);
                    setValues(newValues);
                    setNumValuesToImport(newValues.length);
                    setNonLegacyImport(true);
                  } catch (e) {
                    console.error(e);
                    return;
                  }
                };
                reader.readAsText(file);
              }}
            />
            <label
              className={clsx([
                "custom-file-label",
                fileName ? "remove-file" : "",
              ])}
              htmlFor="savedGroupFileInput"
              data-browse={fileName ? "Remove" : "Browse"}
            >
              {fileName || "Select file..."}
            </label>
          </div>
          {numValuesToImport ? (
            <>
              <FaCheckCircle className="text-success-green" />{" "}
              {`${numValuesToImport} items ready to import`}
            </>
          ) : (
            <></>
          )}
          {fileErrorMessage ? (
            <p className="text-error-red">
              <FaExclamationTriangle /> {fileErrorMessage}
            </p>
          ) : (
            <></>
          )}
        </>
      )}
      {importMethod === "values" && (
        <>
          {rawTextMode ? (
            <Field
              containerClassName="mb-0"
              label="List Values to Include"
              labelClassName="font-weight-bold"
              required
              textarea
              value={rawText}
              placeholder="Use commas to separate values"
              minRows={1}
              onChange={(e) => {
                if (e.target.value === "") {
                  setValues([]);
                } else {
                  setValues(e.target.value.split(",").map((val) => val.trim()));
                }
              }}
            />
          ) : (
            <StringArrayField
              containerClassName="mb-0"
              label="List Values to Include"
              labelClassName="font-weight-bold"
              value={values}
              onChange={(values) => {
                setValues(values);
              }}
              placeholder="Separate values using the 'Enter' key"
              delimiters={["Enter", "Tab"]}
            />
          )}
          <div className="row justify-content-end">
            <a
              href="#"
              style={{ fontSize: "0.8em" }}
              onClick={(e) => {
                e.preventDefault();
                setRawTextMode((prev) => !prev);
              }}
            >
              <FaRetweet /> {rawTextMode ? "Token" : "Raw Text"} Mode
            </a>
          </div>
        </>
      )}
    </>
  );
};
