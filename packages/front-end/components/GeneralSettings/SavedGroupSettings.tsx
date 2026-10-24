import { Box } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import { ConnectSettingsForm } from "@/pages/settings";
import Checkbox from "@/ui/Checkbox";
import { hasFileConfig } from "@/services/env";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function SavedGroupSettings() {
  return (
    <ConnectSettingsForm>
      {({ register, watch, setValue }) => (
        <SettingsGroup
          id="sdk-groups"
          title="Saved Groups"
          description="Scope and size limits for Saved Groups."
          keywords="saved groups project scope id list size limit payload"
        >
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
          <SettingsField
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
      )}
    </ConnectSettingsForm>
  );
}
