import { useState } from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import type { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Switch from "@/ui/Switch";
import { Select, SelectItem } from "@/ui/Select";
import TextField from "@/ui/TextField";
import Modal from "@/ui/Modal";
import ModalForm from "@/ui/Modal/ModalForm";
import Button from "@/ui/Button";

const GIB = 1073741824;

type RunPolicy = "auto-below-threshold" | "always-confirm";

const POLICY_LABELS: Record<RunPolicy, string> = {
  "auto-below-threshold": "Auto-execute below threshold",
  "always-confirm": "Always confirm before executing",
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
          Ask Data
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
          <Modal.Title>Ask Data Settings</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Switch
            id="ask-data-enabled"
            value={enabled}
            onChange={setEnabled}
            label="Enable Ask Data"
            mb="4"
          />
          {enabled && (
            <>
              <Select
                label="Run policy"
                value={policy}
                setValue={(v) => setPolicy(v as RunPolicy)}
              >
                <SelectItem value="auto-below-threshold">
                  Auto-execute below cost threshold
                </SelectItem>
                <SelectItem value="always-confirm">
                  Always confirm before executing
                </SelectItem>
              </Select>
              <Text size="sm" color="text-mid">
                Controls whether the agent must confirm before running SQL
                queries
              </Text>
              {policy === "auto-below-threshold" && (
                <TextField
                  label="Cost threshold (GiB)"
                  type="number"
                  min={1}
                  step={1}
                  value={String(thresholdGib)}
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
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </Modal.Close>
          <Button type="submit">Save</Button>
        </Modal.Footer>
      </ModalForm>
    </Modal.Root>
  );
}
