import { FC, useState } from "react";
import { SAVED_GROUP_SIZE_LIMIT_BYTES } from "shared/util";
import { FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import { Container, Text } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import StringArrayField from "@/ui/StringArrayField";
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
  const { t } = useLingui();
  const { canBypassSavedGroupSizeLimit } = usePermissionsUtil();
  const { savedGroupSizeLimit } = useOrgSettings();

  const [importMethod, setImportMethod] = useState("file");
  const [numValuesToImport, setNumValuesToImport] = useState<number | null>(
    null,
  );
  const [fileName, setFileName] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const largeSavedGroupSupport = useLargeSavedGroupSupport();
  const importCount = numValuesToImport?.toLocaleString();

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
        {...largeSavedGroupSupport}
      />
      <label className="form-group font-weight-bold">
        <Trans>Choose how to enter items for this group:</Trans>
      </label>
      <Container mb="3">
        <RadioGroup
          options={[
            { value: "values", label: t`Manually enter values` },
            {
              value: "file",
              label: t`Import CSV`,
              description: t`File must contain one value per line or all values on one line with commas in-between`,
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
            disabledMessage={t`You don't have permission to bypass the size limit for this Saved Group`}
            description={t`Bypass the size limit of ${savedGroupSizeLimit} items`}
            value={bypassSizeLimit}
            setValue={setBypassSizeLimit}
          />
        </Container>
      )}
      {importMethod === "file" && (
        <>
          <Text weight="bold">
            <Trans>Upload CSV</Trans>
          </Text>
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
                    setFileErrorMessage(t`Only .csv file types are supported`);
                    return;
                  }
                  if (file.size > SAVED_GROUP_SIZE_LIMIT_BYTES) {
                    setFileErrorMessage(t`File size must be less than 1 MB`);
                    return;
                  }

                  const reader = new FileReader();
                  reader.onload = function (e) {
                    try {
                      const str = e.target?.result;
                      if (typeof str !== "string") {
                        setFileErrorMessage(
                          t`Failed to import file. Please try again`,
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
                data-browse={fileName ? t`Remove` : t`Browse`}
              >
                {fileName || t`Select file...`}
              </label>
            </div>
          </Container>
          {numValuesToImport ? (
            <>
              <FaCheckCircle className="text-success-green" />{" "}
              <Trans>{importCount} items ready to import</Trans>
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
          legacyHeight
          containerClassName="mb-0"
          label={t`List Values to Include`}
          labelClassName="font-weight-bold"
          value={values}
          onChange={setValues}
          placeholder={t`Separate values using the 'Enter' key`}
          delimiters={["Enter", "Tab"]}
          enableRawTextMode
          removeDuplicates={false}
          showCopyButton={false}
          required
        />
      )}
    </>
  );
};
