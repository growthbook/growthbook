import React, { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlusBold, PiTrash } from "react-icons/pi";
import { HiBadgeCheck } from "react-icons/hi";
import type { FeatureInterface } from "shared/types/feature";
import { RampScheduleTemplateInterface } from "shared/validators";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import Frame from "@/ui/Frame";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import RampScheduleSection, {
  defaultRampSectionState,
  buildTemplatePayload,
  templateToSectionState,
  formatRampStepSummary,
  type RampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";

// Minimal generic feature used when editing templates (no real feature context).
const GENERIC_FEATURE: Pick<FeatureInterface, "id" | "valueType" | "project"> =
  {
    id: "",
    valueType: "json",
    project: "",
  };


interface EditModalProps {
  template?: RampScheduleTemplateInterface;
  onClose: () => void;
  onSave: () => void;
}

function EditModal({ template, onClose, onSave }: EditModalProps) {
  const { apiCall } = useAuth();
  const [name, setName] = useState(template?.name ?? "");
  const [official, setOfficial] = useState(template?.official ?? false);
  const [saving, setSaving] = useState(false);
  const [rampState, setRampState] = useState<RampSectionState>(() => {
    if (template) {
      return templateToSectionState(template, "edit");
    }
    const s = defaultRampSectionState(undefined);
    return { ...s, mode: "create" };
  });

  return (
    <Modal
      open
      trackingEventModalType="ramp-schedule-template-edit"
      close={onClose}
      header={template ? "Edit Template" : "New Template"}
      loading={saving}
      ctaEnabled={!!name.trim()}
      submit={async () => {
        setSaving(true);
        try {
          const payload = {
            ...buildTemplatePayload({ ...rampState, name }),
            name: name.trim(),
            official,
          };
          if (template) {
            await apiCall(`/ramp-schedule-templates/${template.id}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
          } else {
            await apiCall("/ramp-schedule-templates", {
              method: "POST",
              body: JSON.stringify(payload),
            });
          }
          onSave();
        } finally {
          setSaving(false);
        }
      }}
      cta="Save"
      size="lg"
    >
      <Box mb="5">
        <Field
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Box>
      <Box mb="5">
        <Checkbox
          label="Official template"
          value={official}
          setValue={setOfficial}
          description="Appears at the top of the preset list"
        />
      </Box>
      <RampScheduleSection
        ruleRampSchedule={undefined}
        state={rampState}
        setState={setRampState}
        embedded
        hideNameField
        hideTemplateSave
        feature={GENERIC_FEATURE as FeatureInterface}
        environments={[]}
      />
    </Modal>
  );
}

export default function RampScheduleTemplates() {
  const { data, mutate } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");
  const templates = data?.rampScheduleTemplates ?? [];
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const hasFeature = hasCommercialFeature("ramp-schedules");
  const canCreate =
    hasFeature && permissionsUtil.canCreateFeature({ project: undefined });
  const canUpdate =
    hasFeature &&
    permissionsUtil.canUpdateFeature(
      { project: undefined },
      { project: undefined },
    );
  const canDelete = permissionsUtil.canDeleteFeature({ project: undefined });

  const [editingTemplate, setEditingTemplate] = useState<
    RampScheduleTemplateInterface | null | false
  >(false);

  return (
    <Frame>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h3" size="small">
          Ramp Schedule Templates
        </Heading>
        <PremiumTooltip commercialFeature="ramp-schedules">
          <Button
            variant="outline"
            onClick={() => canCreate && setEditingTemplate(null)}
            disabled={!canCreate}
          >
            <PiPlusBold style={{ marginRight: 4, verticalAlign: "middle" }} />
            New template
          </Button>
        </PremiumTooltip>
      </Flex>

      {templates.length === 0 ? (
        <Text color="text-low" size="medium">
          No templates yet.{" "}
          {hasFeature
            ? "Create one to quickly apply standard ramp schedules to feature rules."
            : "Upgrade to Enterprise to create and manage ramp schedule templates."}
        </Text>
      ) : (
        <Box>
          {[...templates]
            .sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0))
            .map((tmpl) => (
              <Flex
                key={tmpl.id}
                align="center"
                gap="3"
                py="2"
                style={{ borderBottom: "1px solid var(--gray-a4)" }}
              >
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="center" gap="1">
                    {tmpl.official && (
                      <HiBadgeCheck
                        style={{
                          fontSize: "1.2em",
                          lineHeight: "1em",
                          marginTop: "-2px",
                          color: "var(--blue-11)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {canUpdate ? (
                      <Link
                        onClick={() => setEditingTemplate(tmpl)}
                        weight="medium"
                      >
                        {tmpl.name}
                      </Link>
                    ) : (
                      <Text weight="medium" size="medium">
                        {tmpl.name}
                      </Text>
                    )}
                  </Flex>
                  <Text color="text-low" size="small" as="div">
                    {formatRampStepSummary(tmpl.steps)}
                  </Text>
                </Box>
                {canDelete && (
                  <ConfirmButton
                    onClick={async () => {
                      await apiCall(`/ramp-schedule-templates/${tmpl.id}`, {
                        method: "DELETE",
                      });
                      await mutate();
                    }}
                    modalHeader="Delete Template"
                    confirmationText={`Delete "${tmpl.name}"? This cannot be undone.`}
                    cta="Delete"
                    ctaColor="danger"
                  >
                    <IconButton
                      type="button"
                      variant="ghost"
                      color="red"
                      radius="full"
                      size="2"
                      aria-label="Delete template"
                    >
                      <PiTrash size={16} />
                    </IconButton>
                  </ConfirmButton>
                )}
              </Flex>
            ))}
        </Box>
      )}

      {editingTemplate !== false && (
        <EditModal
          template={editingTemplate ?? undefined}
          onClose={() => setEditingTemplate(false)}
          onSave={async () => {
            await mutate();
            setEditingTemplate(false);
          }}
        />
      )}
    </Frame>
  );
}
