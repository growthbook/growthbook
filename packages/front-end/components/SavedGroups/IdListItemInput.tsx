import { FC, useState } from "react";
import { SAVED_GROUP_SIZE_LIMIT_BYTES } from "shared/util";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import { Container, Text } from "@radix-ui/themes";
import StringArrayField from "@/components/Forms/StringArrayField";
import RadioGroup from "@/ui/RadioGroup";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Checkbox from "@/ui/Checkbox";
import useOrgSettings from "@/hooks/useOrgSettings";
import LargeSavedGroupPerformanceWarning, {
  useLargeSavedGroupSupport,
} from "./LargeSavedGroupSupportWarning";

export const IdListItemInput: FC<{
  values: string[];
  listAboveSizeLimit: boolean;
  bypassSizeLimit: boolean;
  projects: string[] | undefined;
  setValues: (newValues: string[]) => void;
  setBypassSizeLimit: React.Dispatch<boolean>;
  openUpgradeModal?: () => void;
}> = ({
  values,
  listAboveSizeLimit,
  setValues,
  openUpgradeModal,
  projects,
  bypassSizeLimit,
  setBypassSizeLimit,
}) => {
  const { canBypassSavedGroupSizeLimit } = usePermissionsUtil();
  const { savedGroupSizeLimit } = useOrgSettings();

  const [importMethod, setImportMethod] = useState("file");
  const [numValuesToImport, setNumValuesToImport] = useState<number | null>(
    null,
  );
  const [fileName, setFileName] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const { unsupportedConnections, hasLargeSavedGroupFeature } =
    useLargeSavedGroupSupport();

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
      {listAboveSizeLimit && (
        <Container mb="2">
          <Checkbox
            disabled={!canBypassSavedGroupSizeLimit(projects)}
            disabledMessage="You don't have permission to bypass the size limit for this saved group"
            description={`Bypass the size limit of ${savedGroupSizeLimit} items`}
            value={bypassSizeLimit}
            setValue={setBypassSizeLimit}
          />
        </Container>
      )}
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
                          "Failed to import file. Please try again",
                        );
                        return;
                      }
                      const newValues = str
                        // Convert newlines to commas, then replace duplicate delimiters
                        .replaceAll(/\n/g, ",")
                        .replaceAll(/,,/g, ",")
                        // Remove trailing delimiters to prevent adding an empty value
                        .replace(/,$/, "")
                        // Remove Windows carriage return
                        .replaceAll(/\r/g, "")
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
        <StringArrayField
          containerClassName="mb-0"
          label="List Values to Include"
          labelClassName="font-weight-bold"
          value={values}
          onChange={setValues}
          placeholder="Separate values using the 'Enter' key"
          delimiters={["Enter", "Tab"]}
          enableRawTextMode
          required
        />
      )}
    </>
  );
};
