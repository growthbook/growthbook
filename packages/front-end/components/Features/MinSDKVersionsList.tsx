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
  return (
    <ul className="mb-1">
      {minVersions.map(({ language, minVersion }) => {
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
