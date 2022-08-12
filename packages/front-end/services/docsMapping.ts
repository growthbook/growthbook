import { DataSourceType } from "back-end/types/datasource";
import { Language } from "../components/Code";

//This is used for IntelliSense across the codebase
type DocsKeys =
  | "/"
  | "/features"
  | "/experiments"
  | "/metrics"
  | "/segments"
  | "/dimensions"
  | "/datasources"
  | "/settings/keys"
  | "/settings/environments"
  | "/settings/webhooks"
  | "user_guide"
  | "sdks"
  | "config_yml"
  | "config"
  | "config_domains_and_ports"
  | "config_organization_settings"
  | "visual_editor"
  | DataSourceType
  | Language;

const docsMap = new Map<DocsKeys, string>([
  ["/", ""],
  ["/features", "/app/features"],
  ["/experiments", "/app/experiments"],
  ["/metrics", "/app/metrics"],
  ["/segments", "/app/datasources"],
  ["/dimensions", "/app/dimensions"],
  ["/datasources", "/app/datasources"],
  ["/settings/keys", "/app/api"],
  ["/settings/environments", "/app/api"],
  ["/settings/webhooks", "/app/webhooks"],
  //DataSourceType
  ["athena", "/app/datasources#aws-athena"],
  ["mixpanel", "/guide/mixpanel"],
  ["bigquery", "/guide/bigquery"],
  ["google_analytics", "/app/datasources#google-analytics"],
  //Language
  ["sdks", "/lib"],
  ["javascript", "/lib/js"],
  ["tsx", "/lib/react"],
  ["go", "/lib/go"],
  ["kotlin", "/lib/kotlin"],
  ["ruby", "/lib/ruby"],
  ["php", "/lib/php"],
  ["python", "/lib/python"],
  //Other
  ["user_guide", "/app"],
  ["config", "/self-host/config"],
  ["config_yml", "/self-host/config#configyml"],
  ["config_domains_and_ports", "/self-host/config#domains-and-ports"],
  ["config_organization_settings", "/self-host/config#organization-settings"],
  ["visual_editor", "/app/visual"],
]);

//for testing use "http://localhost:3200"
const docsOrigin = "https://docs.growthbook.io";

export function inferDocsLink() {
  const key = window.location.pathname;
  const docsPath = docsMap.get(key as DocsKeys)
    ? docsMap.get(key as DocsKeys)
    : "";
  return docsOrigin + docsPath;
}

export function getDocsLink(key: DocsKeys, fallBackKey: DocsKeys = "/") {
  const docsPath = docsMap.get(key)
    ? docsMap.get(key)
    : docsMap.get(fallBackKey)
    ? docsMap.get(fallBackKey)
    : "";
  return docsOrigin + docsPath;
}
