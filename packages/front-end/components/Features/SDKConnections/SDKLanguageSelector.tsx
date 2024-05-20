import { SDKLanguage } from "back-end/types/sdk-connection";
import { useState } from "react";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
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

function LanguageOption({
  language,
  selected,
  setValue,
  multiple,
}: {
  language: SDKLanguage;
  selected: Set<SDKLanguage>;
  setValue: (languages: SDKLanguage[]) => void;
  multiple: boolean;
}) {
  return (
    <div
      className={`hover-highlight cursor-pointer border rounded mr-2 mb-2 ${
        selected.has(language) ? "bg-light" : ""
      }`}
      style={{
        height: 50,
        padding: 10,
        boxShadow: selected.has(language)
          ? "0 0 0 1px var(--text-color-primary)"
          : "",
      }}
      key={language}
      onClick={(e) => {
        e.preventDefault();
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
  const selected = new Set(value);

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
      (language) => !limitLanguages || limitLanguages.includes(language)
    );
  };

  const frontEnd = filterLanguages(["javascript", "react"]);
  const backEnd = filterLanguages([
    "nodejs",
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
    "nocode-other",
  ]);

  if (useTabs) {
    const languages = getLanguagesByFilter(languageFilter);
    return (
      <ControlledTabs
        buttonsClassName="px-3"
        buttonsWrapperClassName="mb-3"
        active={languageFilter}
        setActive={(v) => setLanguageFilter((v ?? "all") as LanguageFilter)}
      >
        {Object.keys(tabs).map((tab) => (
          <Tab
            key={tab}
            id={tab}
            display={
              <span
                className={
                  tab === languageFilter
                    ? "font-weight-bold text-main"
                    : undefined
                }
              >
                {tabs[tab]}
              </span>
            }
            padding={false}
          >
            <div className="d-flex flex-wrap">
              {languages.map((l) => (
                <LanguageOption
                  key={l}
                  language={l}
                  setValue={setValue}
                  selected={selected}
                  multiple={multiple}
                />
              ))}
            </div>
          </Tab>
        ))}
      </ControlledTabs>
    );
  }

  return (
    <div>
      <div className="row">
        {backEnd.length > 0 && (
          <div className="col-auto">
            {renderLabels && (
              <div className="small">
                <strong>Back-end</strong>
              </div>
            )}
            <div className="d-flex flex-wrap">
              {backEnd.map((l) => (
                <LanguageOption
                  key={l}
                  language={l}
                  setValue={setValue}
                  selected={selected}
                  multiple={multiple}
                />
              ))}
            </div>
          </div>
        )}
        {frontEnd.length > 0 && (
          <div className="col-auto">
            {renderLabels && (
              <div className="small">
                <strong>Front-end</strong>
              </div>
            )}
            <div className="d-flex align-items-center">
              {frontEnd.map((l) => (
                <LanguageOption
                  key={l}
                  language={l}
                  setValue={setValue}
                  selected={selected}
                  multiple={multiple}
                />
              ))}
            </div>
          </div>
        )}
        {mobile.length > 0 && (
          <div className="col-auto">
            {renderLabels && (
              <div className="small">
                <strong>Mobile</strong>
              </div>
            )}
            <div className="d-flex">
              {mobile.map((l) => (
                <LanguageOption
                  key={l}
                  language={l}
                  setValue={setValue}
                  selected={selected}
                  multiple={multiple}
                />
              ))}
            </div>
          </div>
        )}
        {edge.length > 0 && (
          <div className="col-auto">
            {renderLabels && (
              <div className="small">
                <strong>Edge</strong>
              </div>
            )}
            <div className="d-flex">
              {edge.map((l) => (
                <LanguageOption
                  key={l}
                  language={l}
                  setValue={setValue}
                  selected={selected}
                  multiple={multiple}
                />
              ))}
            </div>
          </div>
        )}
        {nocode.length > 0 && (
          <div className="col-auto">
            {renderLabels && (
              <div className="small">
                <strong>No/Low Code Platform</strong>
              </div>
            )}
            <div className="d-flex">
              {nocode.map((l) => (
                <LanguageOption
                  key={l}
                  language={l}
                  setValue={setValue}
                  selected={selected}
                  multiple={multiple}
                />
              ))}
            </div>
          </div>
        )}
        {includeOther && (!limitLanguages || limitLanguages.includes("other")) && (
          <div className="col-auto">
            {renderLabels && (
              <div className="small">
                <strong>Other</strong>
              </div>
            )}
            <LanguageOption
              language={"other"}
              setValue={setValue}
              selected={selected}
              multiple={multiple}
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
