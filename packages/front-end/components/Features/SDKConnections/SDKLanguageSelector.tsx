import { SDKLanguage } from "back-end/types/sdk-connection";
import clsx from "clsx";
import SDKLanguageLogo from "./SDKLanguageLogo";

function LanguageOption({
  language,
  selected,
  setValue,
}: {
  language: SDKLanguage;
  selected: Set<SDKLanguage>;
  setValue: (languages: SDKLanguage[]) => void;
}) {
  return (
    <div
      className={clsx("cursor-pointer border rounded m-1", {
        "bg-purple-light": selected.has(language),
      })}
      style={{
        height: 50,
        padding: 10,
      }}
      key={language}
      onClick={(e) => {
        e.preventDefault();
        if (selected.has(language)) {
          selected.delete(language);
        } else {
          selected.add(language);
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
}: {
  value: SDKLanguage[];
  setValue: (languages: SDKLanguage[]) => void;
}) {
  const selected = new Set(value);

  const frontEnd: SDKLanguage[] = ["javascript", "react"];
  const backEnd: SDKLanguage[] = [
    "php",
    "ruby",
    "python",
    "java",
    "csharp",
    "go",
  ];
  const mobile: SDKLanguage[] = ["ios", "android", "flutter"];

  return (
    <div className="form-group">
      <label>Tech Stack</label>
      <small className="text-muted ml-3">(Select all that apply)</small>
      <div className="row">
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
              />
            ))}
          </div>
        </div>
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
              />
            ))}
          </div>
        </div>
        <div className="col-auto">
          <small>
            <strong>Other</strong>
          </small>
          <LanguageOption
            language={"other"}
            setValue={setValue}
            selected={selected}
          />
        </div>
      </div>
    </div>
  );
}
