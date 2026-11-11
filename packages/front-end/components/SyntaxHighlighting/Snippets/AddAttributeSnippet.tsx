import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { SDKLanguage } from "shared/types/sdk-connection";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import { paddedVersionString } from "@growthbook/growthbook";
import { PiCode } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import useOrgSettings from "@/hooks/useOrgSettings";
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
  sha256,
} from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";
import { languageMapping } from "@/components/Features/SDKConnections/SDKLanguageLogo";

// No-code and edge SDKs set attributes another way, so they have no snippet.
const SNIPPET_LANGUAGES = (
  Object.keys(languageMapping) as SDKLanguage[]
).filter((language) => getSetAttributesCode(language, {}) !== null);

// SDK Connection languages in these projects are listed first.
export default function AddAttributeSnippet({
  property,
  value,
  projects,
  nested = false,
  secure = false,
}: {
  property: string;
  value: unknown;
  projects: string[];
  nested?: boolean;
  secure?: boolean;
}) {
  const [pickedLanguage, setPickedLanguage] = useState<SDKLanguage | null>(
    null,
  );
  const { data: sdkConnectionsData } = useSDKConnections();
  const { secureAttributeSalt = "" } = useOrgSettings();

  const connections = (sdkConnectionsData?.connections ?? []).filter(
    (c) =>
      !projects.length ||
      !c.projects.length ||
      c.projects.some((p) => projects.includes(p)),
  );
  const connectedLanguages = [
    ...new Set(connections.flatMap((c) => c.languages)),
  ].filter((l) => SNIPPET_LANGUAGES.includes(l));
  const otherLanguages = SNIPPET_LANGUAGES.filter(
    (l) => !connectedLanguages.includes(l),
  );
  const language = pickedLanguage ?? connectedLanguages[0] ?? "javascript";
  const matching = connections.filter((c) => c.languages.includes(language));
  // The newest version among this language's connections. Versions only
  // change the code at a few cutoffs, so this is also every connection's code
  // when they all fall on the same side of one.
  const version =
    matching
      // Same rule as the setup snippet: a multi-language connection's version
      // isn't specific to this language.
      .flatMap((c) => (c.languages.length === 1 && c.sdkVersion) || [])
      .sort((a, b) =>
        paddedVersionString(b).localeCompare(paddedVersionString(a)),
      )[0] ?? getLatestSDKVersion(language);
  const hashed =
    secure && matching.some((c) => c.hashSecureAttributes)
      ? Array.isArray(value)
        ? value.map((v) => sha256(String(v), secureAttributeSalt))
        : sha256(String(value), secureAttributeSalt)
      : value;
  const sdkCode = getAddAttributeCode(language, property, {
    version,
    value: hashed,
    nested,
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
