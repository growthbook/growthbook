import { interleavingExposureQueryEndpoints } from "shared/api-endpoints";
import React, { FC, useMemo, useState } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  ApiInterleavingExposureQueryInterface,
  INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
  INTERLEAVING_ITEM_FIELD_COMPETITIVE,
  INTERLEAVING_ITEM_FIELD_ITEM_ID,
  INTERLEAVING_ITEM_FIELD_VARIATION,
  INTERLEAVING_ITEMS_COLUMN,
} from "shared/validators";
import { useForm } from "react-hook-form";
import { PiArrowSquareOut } from "react-icons/pi";
import { TestQueryRow } from "shared/types/integrations";
import { Box } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Code from "@/components/SyntaxHighlighting/Code";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import EditSqlModal from "@/components/SchemaBrowser/EditSqlModal";
import { useRestApiCall } from "@/services/restApi";

type InterleavingExposureQueryFormValues = {
  name: string;
  description?: string;
  userIdType: string;
  query: string;
};

type Props = {
  interleavingExposureQuery?: ApiInterleavingExposureQueryInterface;
  dataSource: DataSourceInterfaceWithParams;
  mode: "add" | "edit";
  onSave: (q: ApiInterleavingExposureQueryInterface) => void;
  onCancel: () => void;
};

export const AddEditInterleavingExposureQueryModal: FC<Props> = ({
  interleavingExposureQuery,
  dataSource,
  mode,
  onSave,
  onCancel,
}) => {
  const { t } = useLingui();
  const restApiCall = useRestApiCall();

  const userIdTypeOptions = dataSource?.settings?.userIdTypes ?? [];
  const defaultUserId = userIdTypeOptions[0]?.userIdType ?? "user_id";

  const defaultQuery = `SELECT\n  ${defaultUserId} as ${defaultUserId},\n  timestamp as timestamp,\n  experiment_id as experiment_id,\n  ranking_id as ranking_id,\n  items as items\nFROM my_interleaving_impressions`;

  const [uiMode, setUiMode] = useState<"view" | "sql">("view");

  const form = useForm<InterleavingExposureQueryFormValues>({
    defaultValues:
      mode === "edit" && interleavingExposureQuery
        ? {
            name: interleavingExposureQuery.name,
            description: interleavingExposureQuery.description ?? "",
            userIdType: interleavingExposureQuery.userIdTypes[0] ?? "",
            query: interleavingExposureQuery.query,
          }
        : {
            name: "",
            description: "",
            userIdType: defaultUserId,
            query: defaultQuery,
          },
  });

  const userEnteredUserIdType = form.watch("userIdType");
  const userEnteredQuery = form.watch("query");
  const name = form.watch("name");

  const requiredColumns = useMemo(
    () =>
      new Set([
        ...INTERLEAVING_EXPOSURE_REQUIRED_COLUMNS,
        userEnteredUserIdType,
      ]),
    [userEnteredUserIdType],
  );

  const saveEnabled =
    !!name.trim() && !!userEnteredUserIdType && !!userEnteredQuery.trim();

  const handleSubmit = form.handleSubmit(async (value) => {
    const sharedFields = {
      name: value.name.trim(),
      description: value.description,
      userIdTypes: [value.userIdType],
      query: value.query,
    };

    const res =
      mode === "edit" && interleavingExposureQuery
        ? await restApiCall(
            interleavingExposureQueryEndpoints.updateInterleavingExposureQuery,
            {
              params: { id: interleavingExposureQuery.id },
              body: sharedFields,
            },
          )
        : await restApiCall(
            interleavingExposureQueryEndpoints.createInterleavingExposureQuery,
            { body: { datasourceId: dataSource.id, ...sharedFields } },
          );

    onSave(res.interleavingExposureQuery);
  });

  const validateResponse = (result: TestQueryRow) => {
    if (!result) return;
    const returnedColumns = new Set(
      Object.keys(result).map((c) => c.toLowerCase()),
    );
    const missingColumns = Array.from(requiredColumns).filter(
      (col) => !returnedColumns.has(col.toLowerCase()),
    );
    if (missingColumns.length > 0) {
      const missing = missingColumns.join(", ");
      throw new Error(
        t`You are missing the following columns: ${missing}. Alias your columns to these names.`,
      );
    }
  };

  const queryName = interleavingExposureQuery?.name ?? null;
  const modalTitle =
    mode === "add"
      ? t`Add an Interleaving Exposure Query`
      : queryName !== null
        ? t`Edit ${queryName} query`
        : t`Edit Interleaving Exposure query`;

  if (uiMode === "sql") {
    return (
      <EditSqlModal
        close={() => setUiMode("view")}
        datasourceId={dataSource.id || ""}
        requiredColumns={requiredColumns}
        value={userEnteredQuery}
        save={async (sql) => {
          form.setValue("query", sql);
        }}
        validateResponseOverride={validateResponse}
        sqlObjectInfo={{
          objectType: "Interleaving Exposure Query",
          objectName: form.watch("name"),
        }}
      />
    );
  }

  return (
    <ModalStandard
      trackingEventModalType="interleaving-exposure-query"
      open={true}
      submit={handleSubmit}
      close={onCancel}
      size="lg"
      header={modalTitle}
      cta={t`Save`}
      ctaEnabled={saveEnabled}
    >
      <Box>
        <Field label={t`Display name`} required {...form.register("name")} />
        <Field
          label={t`Description (optional)`}
          textarea
          minRows={1}
          maxLength={MAX_DESCRIPTION_LENGTH}
          {...form.register("description")}
        />
        <SelectField
          label={t`Identifier type`}
          options={userIdTypeOptions.map((i) => ({
            value: i.userIdType,
            label: i.userIdType,
          }))}
          required
          value={form.watch("userIdType")}
          onChange={(value) => form.setValue("userIdType", value)}
        />

        <Box mb="3">
          <Box mb="2">
            <Text as="label" weight="semibold">
              <Trans>Query</Trans>
            </Text>
          </Box>
          {userEnteredQuery === defaultQuery && (
            <Callout status="info" mb="2">
              <Trans>
                The prefilled query below may require editing to fit your data
                structure.
              </Trans>
            </Callout>
          )}
          {userEnteredQuery && (
            <Code language="sql" code={userEnteredQuery} expandable={true} />
          )}
          <Box>
            <Button
              mt="2"
              onClick={() => setUiMode("sql")}
              icon={<PiArrowSquareOut />}
              iconPosition="right"
            >
              <Trans>Customize SQL</Trans>
            </Button>
          </Box>
        </Box>

        <Callout status="info">
          <Trans>
            Return one row per impression.{" "}
            <code>{INTERLEAVING_ITEMS_COLUMN}</code> is a JSON array of the
            ranked items, each with{" "}
            <code>{INTERLEAVING_ITEM_FIELD_ITEM_ID}</code>,{" "}
            <code>{INTERLEAVING_ITEM_FIELD_VARIATION}</code> and{" "}
            <code>{INTERLEAVING_ITEM_FIELD_COMPETITIVE}</code>.
          </Trans>
        </Callout>
      </Box>
    </ModalStandard>
  );
};

export default AddEditInterleavingExposureQueryModal;
