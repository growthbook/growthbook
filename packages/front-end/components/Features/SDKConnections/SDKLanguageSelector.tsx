import { SDKLanguage } from "back-end/types/sdk-connection";
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
}: {
  value: SDKLanguage[];
  setValue: (languages: SDKLanguage[]) => void;
  multiple?: boolean;
  includeOther?: boolean;
}) {
  const selected = new Set(value);

  const frontEnd: SDKLanguage[] = ["javascript", "react"];
  const backEnd: SDKLanguage[] = [
    "nodejs",
    "php",
    "ruby",
    "python",
    "java",
    "csharp",
    "go",
  ];
  const mobile: SDKLanguage[] = ["ios", "android", "flutter"];

  return (
    <div>
      <div className="row">
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
        {includeOther && (
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
      </div>
    </div>
  );
}
