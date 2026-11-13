import { CSSProperties, useRef, useState } from "react";
import type { Ace } from "ace-builds";
import { PiKey } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { WebhookSecretFrontEndInterface } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import { DocLink } from "@/components/DocLink";
import { buildRefInsertion } from "@/components/Constants/jsonConstantInsert";
import FormatJsonAction from "@/components/Features/FormatJsonAction";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

// `{{ KEY }}` or `{{[KEY]}}`, as the server reads them.
const SECRET_REF_RE = /\{\{\s*\[?([^\]{}]+?)\]?\s*\}\}/g;

// Puts a secret's reference into the string at the editor's cursor, as the
// constants button does for a feature value. False when it has nowhere to go.
function insertSecret(editor: Ace.Editor | null, key: string): boolean {
  if (!editor) return false;
  try {
    const insertion = buildRefInsertion(
      editor.getValue(),
      editor.session.doc.positionToIndex(editor.getCursorPosition()),
      `{{ ${key} }}`,
    );
    if (!insertion) return false;
    editor.session.insert(
      editor.session.doc.indexToPosition(insertion.index, 0),
      insertion.text,
    );
    editor.focus();
    return true;
  } catch {
    // The editor can be torn down under an open menu.
    return false;
  }
}

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
      trigger={
        <Button variant="ghost" size="sm" icon={<PiKey />} disabled={disabled}>
          Insert secret
        </Button>
      }
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
  label = "Headers",
  value,
  setValue,
  valid,
  endpoint,
  disabled,
  minLines = 3,
  containerStyle,
}: {
  label?: string;
  value: string;
  setValue: (value: string) => void;
  valid: boolean;
  endpoint: string;
  disabled?: boolean;
  minLines?: number;
  containerStyle?: CSSProperties;
}) {
  const { webhookSecrets } = useDefinitions();
  const editor = useRef<Ace.Editor | null>(null);

  const referenced = new Set(
    [...value.matchAll(SECRET_REF_RE)].map((m) => m[1].trim()),
  );
  const used = webhookSecrets.filter((s) => referenced.has(s.key));

  return (
    <Box>
      <Flex align="center" justify="between" gap="3" mb="1">
        <Text as="label" weight="semibold" mb="0">
          {label}
        </Text>
        {webhookSecrets.length > 0 && (
          <InsertSecretMenu
            secrets={webhookSecrets}
            endpoint={endpoint}
            disabled={disabled}
            onInsert={(key) => insertSecret(editor.current, key)}
          />
        )}
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
        error={valid ? undefined : "Invalid JSON"}
        helpText={
          <Box style={{ minWidth: 0 }}>
            <Text>
              JSON format for headers.
              {/* Without secrets to pick, the docs say how to add one. */}
              {!webhookSecrets.length && (
                <>
                  {" "}
                  Supports{" "}
                  <DocLink docSection="webhookSecrets">webhook secrets</DocLink>
                  .
                </>
              )}
            </Text>
            {used.length > 0 && (
              <Flex align="center" wrap="wrap" gap="2">
                <Text size="sm" color="text-low" weight="medium">
                  Secrets used:
                </Text>
                {used.map((s) => (
                  <Badge key={s.id} variant="soft" color="gray" label={s.key} />
                ))}
              </Flex>
            )}
          </Box>
        }
      />
    </Box>
  );
}
