import React, { FC, useState } from "react";
import { PiShieldCheckBold, PiShieldSlashBold } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useForm } from "react-hook-form";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Heading } from "@radix-ui/themes";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  useCustomFields,
  filterCustomFieldsForSectionAndProject,
} from "@/hooks/useCustomFields";
import Markdown from "@/components/Markdown/Markdown";
import Modal from "@/components/Modal";
import DataList, { DataListItem } from "@/ui/DataList";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import DraftRevisionCallout from "@/components/Features/DraftRevisionCallout";
import CustomFieldInput from "./CustomFieldInput";

/** Optional draft-mode context for feature metadata approval flows. */
export interface CustomFieldDraftInfo {
  /** Version of the existing active draft to bundle changes into, or undefined to create new. */
  targetDraftVersion: number | undefined;
  /** Active draft revision, if any, for the callout message. */
  activeDraft: { version: number; status: string } | null;
  /** Called with the new/updated draft version after save so the UI can switch to it. */
  onDraftCreated: (version: number) => void;
}

const CustomFieldDisplay: FC<{
  label?: string;
  canEdit?: boolean;
  mutate?: () => void;
  className?: string;
  section: CustomFieldSection;
  target: ExperimentInterfaceStringDates | FeatureInterface;
  mt?: "1" | "2" | "3" | "4" | "5" | "6";
  /** When provided, the edit modal shows a draft callout and "Save to Draft" CTA. */
  draftInfo?: CustomFieldDraftInfo;
  /** When true, always show the approval shield badge (gated or not). */
  showApprovalBadge?: boolean;
}> = ({
  label = "Additional Fields",
  canEdit = true,
  mutate,
  className = "",
  section,
  target,
  mt,
  draftInfo,
  showApprovalBadge = false,
}) => {
  const [editModal, setEditModal] = useState(false);
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    section,
    target.project,
  );
  const customFieldsMap = new Map();
  const defaultFields: Record<string, string> = {};
  if (customFields && customFields.length) {
    customFields.map((v) => {
      defaultFields[v.id] =
        v.type === "boolean"
          ? JSON.stringify(!!v.defaultValue)
          : v.type === "multiselect"
            ? JSON.stringify([v?.defaultValue ? v.defaultValue : ""])
            : "" + (v?.defaultValue ? v.defaultValue : "");
      customFieldsMap.set(v.id, v);
    });
  }

  const currentCustomFields = target?.customFields || {};
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");
  const form = useForm<
    Partial<ExperimentInterfaceStringDates | FeatureInterface>
  >({
    defaultValues: {
      customFields: target?.customFields || defaultFields,
    },
  });
  const { apiCall } = useAuth();
  const submitForm = async (value) => {
    if (section === "experiment") {
      await apiCall(`/experiment/${target.id}`, {
        method: "POST",
        body: JSON.stringify({ ...value }),
      });
    } else if (section === "feature") {
      const body: Record<string, unknown> = { ...value };
      if (draftInfo?.targetDraftVersion !== undefined) {
        body.targetDraftVersion = draftInfo.targetDraftVersion;
      }
      const res = await apiCall<{ draftVersion?: number }>(
        `/feature/${target.id}`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );
      if (res?.draftVersion !== undefined && draftInfo) {
        draftInfo.onDraftCreated(res.draftVersion);
      }
    }
    if (mutate) mutate();
  };
  if (!customFields || customFields?.length === 0) {
    return null;
  }

  const displayFieldsObj: DataListItem[] = [];
  const currentValueMap = new Map(
    Object.entries(currentCustomFields ?? {}).map(([fid, cValue]) => [
      fid,
      cValue ?? "",
    ]),
  );
  const getMultiSelectValue = (value: string) => {
    try {
      return JSON.parse(value).join(", ");
    } catch (e) {
      return value;
    }
  };
  const getDisplayValue = (v: CustomField, cValue: string) => {
    return v.type === "multiselect" ? (
      getMultiSelectValue(cValue)
    ) : v.type === "markdown" ? (
      <Markdown className="card-text">{cValue ?? ""}</Markdown>
    ) : v.type === "textarea" ? (
      <div style={{ whiteSpace: "pre" }}>{cValue ?? ""}</div>
    ) : v.type === "url" && cValue !== "" ? (
      <a href={cValue} target="_blank" rel="noreferrer">
        {cValue ?? ""}
      </a>
    ) : v.type === "boolean" ? (
      <>{cValue ? "yes" : "no"}</>
    ) : cValue ? (
      cValue
    ) : (
      <em className="text-muted">none</em>
    );
  };

  Array.from(customFieldsMap.values()).forEach((v: CustomField) => {
    displayFieldsObj.push({
      label: v.name,
      value: getDisplayValue(v, currentValueMap.get(v.id) ?? ""),
      tooltip: v.description,
    });
  });

  if (!hasCustomFieldAccess) return null;

  return (
    <>
      {editModal && (
        <Modal
          trackingEventModalType="edit-custom-fields"
          header={"Edit Custom Fields"}
          open={editModal}
          close={() => {
            setEditModal(false);
          }}
          size="lg"
          submit={form.handleSubmit(async (value) => {
            await submitForm(value);
          })}
          cta={draftInfo ? "Save to Draft" : "Save"}
          useRadixButton={!!draftInfo}
        >
          {draftInfo && (
            <DraftRevisionCallout activeDraft={draftInfo.activeDraft} />
          )}
          {hasCustomFieldAccess ? (
            <CustomFieldInput
              customFields={customFields}
              section={section}
              project={target.project}
              setCustomFields={(value) => {
                form.setValue("customFields", value);
              }}
              currentCustomFields={form.watch("customFields") || {}}
            />
          ) : (
            <div className="text-center">
              <PremiumTooltip commercialFeature={"custom-metadata"}>
                Custom fields are available as part of the enterprise plan
              </PremiumTooltip>
            </div>
          )}
        </Modal>
      )}
      {displayFieldsObj &&
        (section === "feature" ? (
          <>
            <Flex justify="between" align="center" mt={mt}>
              <Flex align="center" gap="1">
                <Heading as="h3" size="4" mb="0">
                  {label ? label : ""}
                </Heading>
                {showApprovalBadge && (
                  <Tooltip
                    body={
                      draftInfo
                        ? "Changes to this section create a draft revision that requires approval before going live."
                        : "Changes to this section are published directly — no draft or approval required."
                    }
                    tipMinWidth="180px"
                  >
                    <span
                      style={{
                        color: draftInfo ? "var(--violet-9)" : "var(--gray-8)",
                        lineHeight: 1,
                        display: "flex",
                      }}
                    >
                      {draftInfo ? (
                        <PiShieldCheckBold size={16} />
                      ) : (
                        <PiShieldSlashBold size={16} />
                      )}
                    </span>
                  </Tooltip>
                )}
              </Flex>
              <div className="flex-1" />
              {canEdit && hasCustomFieldAccess && (
                <Button variant="ghost" onClick={() => setEditModal(true)}>
                  Edit
                </Button>
              )}
            </Flex>
            <DataList data={displayFieldsObj} maxColumns={3} />
          </>
        ) : (
          <Frame className={className} my="3">
            <Box>
              <Flex justify="between" align="center">
                <Heading as="h4" size="3">
                  {label ? label : ""}
                </Heading>
                <div className="flex-1" />
                {canEdit && hasCustomFieldAccess && (
                  <Button variant="ghost" onClick={() => setEditModal(true)}>
                    Edit
                  </Button>
                )}
              </Flex>
              <DataList data={displayFieldsObj} maxColumns={3} />
            </Box>
          </Frame>
        ))}
    </>
  );
};

export default CustomFieldDisplay;
