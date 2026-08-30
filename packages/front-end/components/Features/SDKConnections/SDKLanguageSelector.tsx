import { SDKLanguage } from "shared/types/sdk-connection";
import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import SDKLanguageLogo, {
  getLanguagesByFilter,
  LanguageFilter,
} from "./SDKLanguageLogo";

const tabs: Record<LanguageFilter, string> = {
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
    <div
      className={`hover-highlight d-inline-flex align-items-center cursor-pointer border rounded ${
        selected ? "bg-light" : ""
      }`}
      style={{
        height: 50,
        padding: "0 10px",
        boxShadow: selected ? "0 0 0 1px var(--text-color-primary)" : "",
      }}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <SDKLanguageLogo language={language} showLabel={true} size={30} />
    </div>
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
            {Object.keys(tabs).map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                <span
                  className={tab === languageFilter ? "text-main" : undefined}
                >
                  {tabs[tab]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Box>

        {Object.keys(tabs).map((tab) => (
          <TabsContent key={tab} value={tab}>
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "0.6em" }}
            >
              {languages.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  return (
    <div>
      <div className="row">
        {backEnd.length > 0 && (
          <div className="col-auto mb-1">
            {renderLabels && (
              <div className="small mb-2">
                <strong>Back-end</strong>
              </div>
            )}
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "0.6em" }}
            >
              {backEnd.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </div>
          </div>
        )}
        {frontEnd.length > 0 && (
          <div className="col-auto mb-1">
            {renderLabels && (
              <div className="small mb-2">
                <strong>Front-end</strong>
              </div>
            )}
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "0.6em" }}
            >
              {frontEnd.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </div>
          </div>
        )}
        {mobile.length > 0 && (
          <div className="col-auto mb-1">
            {renderLabels && (
              <div className="small mb-2">
                <strong>Mobile</strong>
              </div>
            )}
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "0.6em" }}
            >
              {mobile.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </div>
          </div>
        )}
        {edge.length > 0 && (
          <div className="col-auto mb-1">
            {renderLabels && (
              <div className="small mb-2">
                <strong>Edge</strong>
              </div>
            )}
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "0.6em" }}
            >
              {edge.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </div>
          </div>
        )}
        {nocode.length > 0 && (
          <div className="col-auto mb-1">
            {renderLabels && (
              <div className="small mb-2">
                <strong>No/Low Code Platform</strong>
              </div>
            )}
            <div
              className="d-flex flex-wrap pb-3"
              style={{ rowGap: "1em", columnGap: "0.6em" }}
            >
              {nocode.map((l) => (
                <SDKLanguageOption
                  key={l}
                  language={l}
                  onClick={() => handleLanguageOptionClick(l)}
                  selected={selected.has(l)}
                />
              ))}
            </div>
          </div>
        )}
        {includeOther &&
          (!limitLanguages || limitLanguages.includes("other")) && (
            <div className="col-auto mb-1">
              {renderLabels && (
                <div className="small mb-2">
                  <strong>Other</strong>
                </div>
              )}
              <SDKLanguageOption
                language={"other"}
                onClick={() => handleLanguageOptionClick("other")}
                selected={selected.has("other")}
              />
            </div>
          )}
        {!includeAll && limitLanguages && !hideShowAllLanguages && (
          <div className="col-auto align-self-center" style={{ marginTop: 10 }}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setIncludeAll(true);
              }}
            >
              Show All Languages
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
