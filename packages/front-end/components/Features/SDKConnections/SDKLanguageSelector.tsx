import { SDKLanguage } from "back-end/types/sdk-connection";
import { useState } from "react";
import SDKLanguageLogo from "./SDKLanguageLogo";

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
      className={`cursor-pointer border rounded mr-2 mb-2 ${
        selected.has(language) ? "bg-light" : ""
      }`}
      style={{
        height: 50,
        padding: 10,
        boxShadow: selected.has(language)
          ? "0 0 0 3px var(--text-color-primary)"
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
}: {
  value: SDKLanguage[];
  setValue: (languages: SDKLanguage[]) => void;
  multiple?: boolean;
  includeOther?: boolean;
  limitLanguages?: SDKLanguage[];
}) {
  const selected = new Set(value);

  // If no languages are selected, select "other"
  if (!multiple && !selected.size) {
    selected.add("other");
  }

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
  ]);
  const mobile = filterLanguages(["ios", "android", "flutter"]);

  return (
    <div>
      <div className="row">
        {backEnd.length > 0 && (
          <div className="col-auto">
            <small>
              <strong>Back-end</strong>
            </small>
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
            <small>
              <strong>Front-end</strong>
            </small>
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
            <small>
              <strong>Mobile</strong>
            </small>
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
        {includeOther && (!limitLanguages || limitLanguages.includes("other")) && (
          <div className="col-auto">
            <small>
              <strong>Other</strong>
            </small>
            <LanguageOption
              language={"other"}
              setValue={setValue}
              selected={selected}
              multiple={multiple}
            />
          </div>
        )}
        {!includeAll && limitLanguages && (
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
