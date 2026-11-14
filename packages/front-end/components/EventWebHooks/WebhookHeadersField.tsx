import { CSSProperties, forwardRef, useRef, useState } from "react";
import type { Ace } from "ace-builds";
import { PiKey } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { WebhookSecretFrontEndInterface } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { formatJSON } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import InfoPopover from "@/components/EventWebHooks/InfoPopover";
import { DocLink } from "@/components/DocLink";
import { insertRefAtCursor } from "@/components/Constants/jsonConstantInsert";
import FormatJsonAction from "@/components/Features/FormatJsonAction";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";

// `{{ KEY }}` or `{{[KEY]}}`, as the server reads them.
const SECRET_REF_RE = /\{\{\s*\[?([^\]{}]+?)\]?\s*\}\}/g;

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

// For a form's submit: broken JSON is repaired into the field for another
// look, as a feature value is, or refused when it can't be.
export function checkHeadersOnSubmit(
  value: string,
  setValue: (value: string) => void,
) {
  if (isJson(value)) return;
  const fixed = formatJSON(value);
  if (!fixed) throw new Error("Headers must be valid JSON.");
  setValue(fixed);
  throw new Error(
    "We fixed some errors in the headers. If they look correct, submit again.",
  );
}

const InsertSecretButton = forwardRef<
  HTMLButtonElement,
  { disabled?: boolean }
>(function InsertSecretButton(props, ref) {
  return (
    <Button ref={ref} variant="ghost" size="sm" icon={<PiKey />} {...props}>
      Insert secret
    </Button>
  );
});

function InsertSecretMenu({
  secrets,
  endpoint,
  disabled,
  onInsert,
}: {
  secrets: WebhookSecretFrontEndInterface[];
  endpoint: string;
  disabled?: boolean;
  onInsert: (key: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // Swallows the one close Radix fires after a failed select.
  const keepOpen = useRef(false);

  // A secret limited to other origins isn't filled in for this endpoint.
  let origin: string | null = null;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    // Not a URL yet: nothing to rule out.
  }

  return (
    <DropdownMenu
      variant="soft"
      menuPlacement="end"
      menuWidth={280}
      open={open}
      onOpenChange={(o) => {
        if (!o && keepOpen.current) {
          keepOpen.current = false;
          return;
        }
        setOpen(o);
        setFailed(false);
      }}
      trigger={<InsertSecretButton disabled={disabled} />}
    >
      {[...secrets]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((secret) => {
          const blocked =
            !!origin &&
            !!secret.allowedOrigins?.length &&
            !secret.allowedOrigins.includes(origin);
          return (
            <DropdownMenuItem
              key={secret.id}
              disabled={blocked}
              tooltip={
                blocked ? "Not allowed for this endpoint's origin." : undefined
              }
              onClick={() => {
                if (onInsert(secret.key)) {
                  setOpen(false);
                } else {
                  keepOpen.current = true;
                  setFailed(true);
                }
              }}
            >
              <Text weight="medium">{secret.key}</Text>
            </DropdownMenuItem>
          );
        })}
      {failed && (
        <Box px="3" py="1">
          <HelperText status="error" size="md">
            Couldn’t insert here — place your cursor in a string value, or where
            one goes.
          </HelperText>
        </Box>
      )}
    </DropdownMenu>
  );
}

// A webhook's headers as JSON, with the org's secrets to insert above it and
// the ones it references listed below, as a feature value lists its constants.
export default function WebhookHeadersField({
  value,
  setValue,
  endpoint,
  disabled,
  minLines = 3,
  containerStyle,
}: {
  value: string;
  setValue: (value: string) => void;
  endpoint: string;
  disabled?: boolean;
  minLines?: number;
  containerStyle?: CSSProperties;
}) {
  const { webhookSecrets } = useDefinitions();
  const canManageSecrets = usePermissionsUtil().canManageWebhookSecrets();
  const editor = useRef<Ace.Editor | null>(null);

  const referenced = new Set(
    [...value.matchAll(SECRET_REF_RE)].map((m) => m[1].trim()),
  );
  const used = webhookSecrets.filter((s) => referenced.has(s.key));

  return (
    <Box>
      <Flex align="center" justify="between" gap="3" mb="1">
        <Text as="label" weight="semibold" mb="0">
          Headers{" "}
          <Text color="text-mid" weight="regular">
            (JSON)
          </Text>
        </Text>
        <Flex align="center" gap="1">
          {webhookSecrets.length > 0 ? (
            <InsertSecretMenu
              secrets={webhookSecrets}
              endpoint={endpoint}
              disabled={disabled}
              // As the constants button does for a feature value.
              onInsert={(key) => {
                try {
                  return (
                    !!editor.current &&
                    insertRefAtCursor(editor.current, `{{ ${key} }}`)
                  );
                } catch {
                  // The editor can be torn down under an open menu.
                  return false;
                }
              }}
            />
          ) : (
            <Popover
              openOnHover
              side="bottom"
              contentStyle={{ maxWidth: 320 }}
              trigger={
                // A disabled button doesn't report the pointer.
                <span style={{ display: "inline-flex" }}>
                  <InsertSecretButton disabled />
                </span>
              }
              content={
                <Text>
                  There are no webhook secrets yet.{" "}
                  {canManageSecrets ? (
                    <>
                      <Link
                        href="/settings/webhooks"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Add one
                      </Link>{" "}
                      to insert it here.
                    </>
                  ) : (
                    "Someone who manages webhooks can add one in Settings."
                  )}
                </Text>
              }
            />
          )}
          <InfoPopover label="About webhook secrets">
            <Text>
              A secret keeps a credential out of the webhook&apos;s settings.
            </Text>
            <Text>
              Reference one as{" "}
              <code style={{ whiteSpace: "nowrap" }}>{"{{ KEY }}"}</code> and
              its value is filled in when the webhook fires.
            </Text>
            <Flex justify="between" gap="3">
              <DocLink docSection="webhookSecrets">Learn more</DocLink>
              {canManageSecrets && (
                <Link
                  href="/settings/webhooks"
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage secrets
                </Link>
              )}
            </Flex>
          </InfoPopover>
        </Flex>
      </Flex>
      <CodeTextArea
        language="json"
        minLines={minLines}
        maxLines={6}
        containerStyle={containerStyle}
        value={value}
        setValue={setValue}
        disabled={disabled}
        onEditorLoad={(e) => (editor.current = e)}
        actions={
          disabled ? null : (
            <FormatJsonAction value={value} setValue={setValue} />
          )
        }
        error={isJson(value) ? undefined : "Invalid JSON"}
        helpText={
          <Box style={{ minWidth: 0 }}>
            {used.length > 0 && (
              <Flex align="center" wrap="wrap" gap="2">
                <Text size="sm" color="text-low" weight="medium">
                  Secrets used:
                </Text>
                {used.map((s) => {
                  const badge = (
                    <Badge
                      key={s.id}
                      variant="soft"
                      color="gray"
                      label={s.key}
                    />
                  );
                  // Where secrets are edited, for someone who can.
                  return canManageSecrets ? (
                    <Link
                      key={s.id}
                      href="/settings/webhooks"
                      target="_blank"
                      rel="noreferrer"
                      underline="hover"
                      style={{ display: "inline-flex" }}
                    >
                      {badge}
                    </Link>
                  ) : (
                    badge
                  );
                })}
              </Flex>
            )}
          </Box>
        }
      />
    </Box>
  );
}
