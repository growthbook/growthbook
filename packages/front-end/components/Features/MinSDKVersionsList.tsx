import {
  SDKCapability,
  getMinSupportedSDKVersions,
} from "shared/sdk-versioning";
import { languageMapping } from "./SDKConnections/SDKLanguageLogo";

export default function MinSDKVersionsList({
  capability,
}: {
  capability: SDKCapability;
}) {
  const minVersions = getMinSupportedSDKVersions(capability);

  const hasNoCode = minVersions.some(({ language }) =>
    language.startsWith("nocode"),
  );

  return (
    <ul className="mb-1">
      {hasNoCode && <li key="nocode">HTML Script Tag</li>}
      {minVersions
        .filter(({ language }) => !language.startsWith("nocode"))
        .map(({ language, minVersion }) => {
          const display = languageMapping[language]?.label || language;
          return (
            <li key={language}>
              {display} &gt;= {minVersion}
            </li>
          );
        })}
    </ul>
  );
}
