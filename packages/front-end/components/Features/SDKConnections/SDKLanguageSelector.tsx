import { SDKLanguage } from "shared/types/sdk-connection";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import SDKLanguageLogo, {
  getLanguagesByFilter,
  LanguageFilter,
} from "./SDKLanguageLogo";

export const LANGUAGE_FILTER_LABELS: Record<LanguageFilter, string> = {
  popular: "Popular",
  all: "All",
  browser: "Browser",
  server: "Server",
  mobile: "Mobile",
  edge: "Edge",
};

export function SDKLanguageOption({
  language,
  selected,
  onClick,
}: {
  language: SDKLanguage;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={selected ? "soft" : "outline"}
      color={selected ? "violet" : "gray"}
      size="lg"
      aria-pressed={selected}
      onClick={onClick}
    >
      <SDKLanguageLogo language={language} showLabel={true} size={30} />
    </Button>
  );
}

export default function SDKLanguageSelector({
  value,
  setValue,
  multiple = false,
  includeOther = true,
  limitLanguages,
  skipLabel = false,
  hideShowAllLanguages = false,
  languageFilter = "popular",
  setLanguageFilter,
}: {
  value: SDKLanguage[];
  setValue: (languages: SDKLanguage[]) => void;
  multiple?: boolean;
  includeOther?: boolean;
  limitLanguages?: SDKLanguage[];
  skipLabel?: boolean;
  hideShowAllLanguages?: boolean;
  languageFilter?: LanguageFilter;
  setLanguageFilter?: (l: LanguageFilter) => void;
}) {
  const useTabs = !!setLanguageFilter;

  let selected = new Set(value);
  const handleLanguageOptionClick = (language: SDKLanguage) => {
    if (selected.has(language)) {
      if (!multiple) return;
      selected.delete(language);
    } else {
      if (multiple) {
        selected.add(language);
      } else {
        selected = new Set([language]);
      }
    }
    setValue([...selected]);
  };

  // If the selected language(s) are not in the "limitLanguages" list, add them
  if (limitLanguages) {
    limitLanguages = Array.from(new Set([...limitLanguages, ...value]));
  }

  // If "other" is the only one selected and the props say to hide "other", show it anyway
  if (
    limitLanguages &&
    limitLanguages.length === 1 &&
    limitLanguages[0] === "other"
  ) {
    includeOther = true;
  }

  const [includeAll, setIncludeAll] = useState(false);

  const renderLabels = !skipLabel || includeAll;

  const filterLanguages = (languages: SDKLanguage[]): SDKLanguage[] => {
    if (includeAll) return languages;
    return languages.filter(
      (language) => !limitLanguages || limitLanguages.includes(language),
    );
  };

  const frontEnd = filterLanguages(["javascript", "react", "nocode-other"]);
  const backEnd = filterLanguages([
    "nodejs",
    "nextjs",
    "php",
    "ruby",
    "python",
    "java",
    "csharp",
    "go",
    "elixir",
  ]);
  const mobile = filterLanguages(["ios", "android", "flutter"]);
  const edge = filterLanguages([
    "edge-cloudflare",
    "edge-fastly",
    "edge-lambda",
    "edge-other",
  ]);
  const nocode = filterLanguages([
    "nocode-shopify",
    "nocode-wordpress",
    "nocode-webflow",
  ]);

  if (useTabs) {
    let languages = getLanguagesByFilter(languageFilter);
    if (!includeOther) {
      languages = languages.filter((l) => l !== "other");
    }
    return (
      <Tabs
        value={languageFilter}
        onValueChange={(v) => setLanguageFilter((v ?? "all") as LanguageFilter)}
      >
        <Box mb="3">
          <TabsList>
            {Object.keys(LANGUAGE_FILTER_LABELS).map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                <span
                  className={tab === languageFilter ? "text-main" : undefined}
                >
                  {LANGUAGE_FILTER_LABELS[tab]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Box>

        {Object.keys(LANGUAGE_FILTER_LABELS).map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Flex wrap="wrap" gap="3" pb="4">
              {languages.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </Flex>
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  const groups: { label: string; languages: SDKLanguage[] }[] = [
    { label: "Back-end", languages: backEnd },
    { label: "Front-end", languages: frontEnd },
    { label: "Mobile", languages: mobile },
    { label: "Edge", languages: edge },
    { label: "No/Low Code Platform", languages: nocode },
  ];
  if (includeOther && (!limitLanguages || limitLanguages.includes("other"))) {
    groups.push({ label: "Other", languages: ["other"] });
  }

  return (
    <Flex wrap="wrap" gapX="5">
      {groups
        .filter((group) => group.languages.length > 0)
        .map((group) => (
          <Box key={group.label} mb="1">
            {renderLabels && (
              <Text as="div" size="sm" weight="semibold" mb="2">
                {group.label}
              </Text>
            )}
            <Flex wrap="wrap" gap="3" pb="4">
              {group.languages.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </Flex>
          </Box>
        ))}
      {!includeAll && limitLanguages && !hideShowAllLanguages && (
        // Level with the tiles beside it, which are as tall as an lg button.
        <Box mb="1" style={{ alignSelf: "flex-end" }}>
          <Flex align="center" height="40px" mb="4">
            <Link onClick={() => setIncludeAll(true)}>Show all languages</Link>
          </Flex>
        </Box>
      )}
    </Flex>
  );
}
