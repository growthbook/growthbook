import { FC, useEffect, useState } from "react";
import { SAVED_GROUP_SIZE_LIMIT_BYTES } from "shared/util";
import {
  FaCheckCircle,
  FaExclamationTriangle,
  FaRetweet,
} from "react-icons/fa";
import clsx from "clsx";
import { Container, Text } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import StringArrayField from "@/components/Forms/StringArrayField";
import RadioGroup from "@/components/Radix/RadioGroup";
import Link from "@/components/Radix/Link";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "./LargeSavedGroupSupportWarning";

export const IdListItemInput: FC<{
  values: string[];
  setValues: (newValues: string[]) => void;
  openUpgradeModal?: () => void;
}> = ({ values, setValues, openUpgradeModal }) => {
  const [rawTextMode, setRawTextMode] = useState(false);
  const [rawText, setRawText] = useState(values.join(", ") || "");
  useEffect(() => {
    setRawText(values.join(","));
  }, [values]);

  const [importMethod, setImportMethod] = useState("file");
  const [numValuesToImport, setNumValuesToImport] = useState<number | null>(
    null
  );
  const [fileName, setFileName] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const {
    unsupportedConnections,
    hasLargeSavedGroupFeature,
  } = useLargeSavedGroupSupport();

  const resetFile = () => {
    setValues([]);
    setNumValuesToImport(null);
    setFileName("");
    setFileErrorMessage("");
  };

  return (
    <>
      <LargeSavedGroupPerformanceWarning
        openUpgradeModal={openUpgradeModal}
        hasLargeSavedGroupFeature={hasLargeSavedGroupFeature}
        unsupportedConnections={unsupportedConnections}
      />
      <label className="form-group font-weight-bold">
        Choose how to enter items for this group:
      </label>
      <Container mb="3">
        <RadioGroup
          options={[
            { value: "values", label: "Manually enter values" },
            {
              value: "file",
              label: "Import CSV",
              description:
                "File must contain one value per line or all values on one line with commas in-between",
            },
          ]}
          value={importMethod}
          setValue={setImportMethod}
        />
      </Container>
      {importMethod === "file" && (
        <>
          <Text weight="bold">Upload CSV</Text>
          <Container mt="2">
            <div
              className="custom-file"
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
                  if (file.size > SAVED_GROUP_SIZE_LIMIT_BYTES) {
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
                      const newValues = str
                        // Convert newlines to commas, then replace duplicate delimiters
                        .replaceAll(/\n/g, ",")
                        .replaceAll(/,,/g, ",")
                        // Remove trailing delimiters to prevent adding an empty value
                        .replace(/,$/, "")
                        .split(",");
                      setFileName(file.name);
                      setValues(newValues);
                      setNumValuesToImport(newValues.length);
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
          </Container>
          {numValuesToImport ? (
            <>
              <FaCheckCircle className="text-success-green" />{" "}
              {`${numValuesToImport.toLocaleString()} items ready to import`}
            </>
          ) : (
            <></>
          )}
          {fileErrorMessage ? (
            <p className="text-danger">
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
              label="List values to include"
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
          <div className="row justify-content-end mr-0">
            <Link
              onClick={(e) => {
                e.preventDefault();
                setRawTextMode((prev) => !prev);
              }}
            >
              <FaRetweet /> Switch to {rawTextMode ? "Token" : "Raw Text"} Mode
            </Link>
          </div>
        </>
      )}
    </>
  );
};
