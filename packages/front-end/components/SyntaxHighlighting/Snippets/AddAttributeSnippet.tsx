import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { SDKLanguage } from "shared/types/sdk-connection";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import { PiCode } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import Text from "@/ui/Text";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@/ui/Select";
import Code from "@/components/SyntaxHighlighting/Code";
import {
  getAddAttributeCode,
  getSetAttributesCode,
} from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";

// No-code and edge SDKs set attributes another way, so they have no snippet.
const SNIPPET_LANGUAGES = (
  Object.keys(languageMapping) as SDKLanguage[]
).filter((language) => getSetAttributesCode(language, {}) !== null);

// How to pass one new attribute from the SDK, in a language the user picks.
// Languages from the user's SDK Connections in these projects come first.
export default function AddAttributeSnippet({
  property,
  value,
  projects,
}: {
  property: string;
  value: unknown;
  projects: string[];
}) {
  const [pickedLanguage, setPickedLanguage] = useState<SDKLanguage | null>(
    null,
  );
  const { data: sdkConnectionsData } = useSDKConnections();

  const connectedLanguages = [
    ...new Set(
      (sdkConnectionsData?.connections ?? [])
        .filter(
          (c) =>
            !projects.length ||
            !c.projects.length ||
            c.projects.some((p) => projects.includes(p)),
        )
        .flatMap((c) => c.languages),
    ),
  ].filter((l) => SNIPPET_LANGUAGES.includes(l));
  const otherLanguages = SNIPPET_LANGUAGES.filter(
    (l) => !connectedLanguages.includes(l),
  );
  const language = pickedLanguage ?? connectedLanguages[0] ?? "javascript";
  const sdkCode = getAddAttributeCode(language, property, {
    version: getLatestSDKVersion(language),
    value,
  });

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" justify="between" gap="2">
        <Flex align="center" gap="2">
          <PiCode />
          <Text weight="semibold" color="text-mid">
            In your app
          </Text>
        </Flex>
        <Select
          size="sm"
          aria-label="SDK language"
          value={language}
          setValue={(v) =>
            setPickedLanguage(SNIPPET_LANGUAGES.find((l) => l === v) ?? null)
          }
        >
          {connectedLanguages.length > 0 && (
            <>
              <SelectGroup>
                <SelectLabel>Your SDK Connections</SelectLabel>
                {connectedLanguages.map((l) => (
                  <SelectItem key={l} value={l}>
                    {languageMapping[l].label}
                  </SelectItem>
                ))}
              </SelectGroup>
              {otherLanguages.length > 0 && <SelectSeparator />}
            </>
          )}
          {otherLanguages.length > 0 && (
            <SelectGroup>
              <SelectLabel>
                {connectedLanguages.length > 0
                  ? "Other languages"
                  : "All languages"}
              </SelectLabel>
              {otherLanguages.map((l) => (
                <SelectItem key={l} value={l}>
                  {languageMapping[l].label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </Select>
      </Flex>
      {sdkCode && (
        <Code
          language={sdkCode.snippet.language}
          filename={sdkCode.snippet.filename}
          code={sdkCode.snippet.code}
          highlightLine={sdkCode.highlightLine}
        />
      )}
    </Flex>
  );
}
