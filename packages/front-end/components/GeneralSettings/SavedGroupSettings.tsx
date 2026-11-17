import { Box } from "@radix-ui/themes";
import { useFormContext } from "react-hook-form";
import Field from "@/components/Forms/Field";
import Checkbox from "@/ui/Checkbox";
import { hasFileConfig } from "@/services/env";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { SettingsField, SettingsGroup, UnsavedMark } from "./SettingsGroup";

export default function SavedGroupSettings() {
  const { register, watch, setValue } =
    useFormContext<OrganizationSettingsWithMetricDefaults>();
  return (
    <>
      <SettingsGroup
        id="sdk-groups"
        title="Saved Groups"
        description="Scope and size limits for Saved Groups."
        keywords="saved groups project scope id list size limit payload"
      >
        <UnsavedMark name="enforceSavedGroupProjectScope">
          <Checkbox
            id="enforceSavedGroupProjectScope"
            label="Enforce Saved Group Project scope"
            description="Block new references, including nested groups, that fall outside a group's Projects. Existing references keep working."
            disabled={hasFileConfig()}
            value={watch("enforceSavedGroupProjectScope") ?? false}
            setValue={(value) =>
              setValue("enforceSavedGroupProjectScope", value, {
                shouldDirty: true,
              })
            }
          />
        </UnsavedMark>
        <SettingsField
          name="savedGroupSizeLimit"
          htmlFor="settings-savedGroupSizeLimit"
          label="ID list size limit"
          help="Keeps SDK payloads small. Roles with Saved Groups Bypass Size Limit can exceed it."
        >
          <Box width="200px">
            <Field
              id="settings-savedGroupSizeLimit"
              size="md"
              type="number"
              min="1"
              step="1"
              append="items"
              placeholder="No limit"
              containerClassName="mb-0"
              disabled={hasFileConfig()}
              {...register("savedGroupSizeLimit", {
                valueAsNumber: true,
                min: 1,
              })}
            />
          </Box>
        </SettingsField>
      </SettingsGroup>
    </>
  );
}
