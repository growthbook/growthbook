import { useState } from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import type { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Checkbox from "@/ui/Checkbox";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import Modal from "@/ui/Modal";
import ModalForm from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";

const GIB = 1073741824;

type RunPolicy = "auto-below-threshold" | "always-confirm" | "auto-always";

const POLICY_LABELS: Record<RunPolicy, string> = {
  "auto-below-threshold": "Auto-execute below threshold",
  "always-confirm": "Always confirm before executing",
  "auto-always": "Always auto-execute",
};

type Props = Omit<DataSourceQueryEditingModalBaseProps, "onCancel">;

export default function AskDataSettings({
  dataSource,
  onSave,
  canEdit,
}: Props) {
  const [editing, setEditing] = useState(false);
  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const askData = dataSource.settings?.askData;
  const enabled = askData?.enabled ?? false;
  const policy: RunPolicy = askData?.runPolicy ?? "auto-below-threshold";
  const thresholdGib = Math.round((askData?.thresholdBytes ?? GIB) / GIB) || 1;

  return (
    <Box>
      <Flex align="center" justify="between" gap="3" mb="2">
        <Heading as="h3" size="md" mb="0">
          Ask data
        </Heading>
        {canEdit && (
          <Link
            weight="medium"
            underline="none"
            onClick={() => setEditing(true)}
          >
            Edit
          </Link>
        )}
      </Flex>
      <p>
        Allow the AI assistant to run read-only SQL queries against this data
        source.
      </p>

      <Card>
        <Flex direction="column" gap="3" p="2">
          <Text
            size="md"
            weight="medium"
            color={enabled ? "text-high" : "text-low"}
          >
            {enabled ? "Enabled" : "Disabled"}
          </Text>
          {enabled && (
            <>
              <Text size="sm" color="text-mid">
                Run policy: {POLICY_LABELS[policy] ?? policy}
              </Text>
              {policy === "auto-below-threshold" && (
                <Text size="sm" color="text-mid">
                  Cost threshold: {thresholdGib} GiB
                </Text>
              )}
            </>
          )}
        </Flex>
      </Card>

      {editing && (
        <EditAskDataModal
          dataSource={dataSource}
          onSave={onSave}
          onClose={() => setEditing(false)}
        />
      )}
    </Box>
  );
}

function EditAskDataModal({
  dataSource,
  onSave,
  onClose,
}: {
  dataSource: Props["dataSource"];
  onSave: Props["onSave"];
  onClose: () => void;
}) {
  const askData = dataSource.settings?.askData;
  const [enabled, setEnabled] = useState(askData?.enabled ?? false);
  const [policy, setPolicy] = useState<RunPolicy>(
    askData?.runPolicy ?? "auto-below-threshold",
  );
  const [thresholdGib, setThresholdGib] = useState(
    Math.round((askData?.thresholdBytes ?? GIB) / GIB) || 1,
  );

  return (
    <Modal.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      size="md"
      trackingEventModalType="edit-ask-data-settings"
    >
      <ModalForm
        onSubmit={async () => {
          await onSave({
            ...dataSource,
            settings: {
              ...dataSource.settings,
              askData: {
                enabled,
                runPolicy: policy,
                thresholdBytes: Math.round(thresholdGib * GIB),
              },
            },
          });
          onClose();
        }}
      >
        <Modal.Header>
          <Modal.Title>Ask data settings</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex gap="3" align="start" mb="4">
            <Checkbox
              value={enabled}
              setValue={setEnabled}
              id="ask-data-enabled"
              mt="1"
            />
            <label htmlFor="ask-data-enabled">
              <Text size="md" weight="medium">
                Enable ask data
              </Text>
            </label>
          </Flex>
          {enabled && (
            <>
              <SelectField
                label="Run policy"
                value={policy}
                onChange={(v) => setPolicy(v as RunPolicy)}
                options={[
                  {
                    value: "auto-below-threshold",
                    label: "Auto-execute below cost threshold",
                  },
                  {
                    value: "always-confirm",
                    label: "Always confirm before executing",
                  },
                  { value: "auto-always", label: "Always auto-execute" },
                ]}
                helpText="Controls whether the agent must confirm before running SQL queries"
              />
              {policy === "auto-below-threshold" && (
                <Field
                  label="Cost threshold (GiB)"
                  type="number"
                  min={1}
                  step={1}
                  value={thresholdGib}
                  onChange={(e) =>
                    setThresholdGib(parseInt(e.target.value) || 1)
                  }
                  helpText="Queries scanning more than this amount require confirmation"
                />
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="ghost">Cancel</Button>
          </Modal.Close>
          <Button type="submit">Save</Button>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}
