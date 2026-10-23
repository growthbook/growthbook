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
            description="Validate new Saved Group references and additional targeting Projects, including nested groups. Existing references keep working through edits and publication. Blocks group changes that introduce scope violations. Off by default."
            disabled={hasFileConfig()}
            value={watch("enforceSavedGroupProjectScope") ?? false}
            setValue={(value) =>
              setValue("enforceSavedGroupProjectScope", value, {
                shouldDirty: true,
              })
            }
          />
          <SettingsField
            label="ID list size limit"
            help={
              <>
                Keeps SDK payloads small. Admins and users with the{" "}
                <i>Saved Groups Bypass Size Limit</i> policy can exceed it
                manually.
              </>
            }
          >
            <Box width="200px">
              <Field
                size="legacy"
                type="number"
                min="1"
                step="1"
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
