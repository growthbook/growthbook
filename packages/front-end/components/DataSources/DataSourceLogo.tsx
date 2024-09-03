import { SDKLanguage } from "back-end/types/sdk-connection";
import { IconBaseProps, IconType } from "react-icons";
import { SiGoogleanalytics } from "react-icons/si";
import React, { ReactElement } from "react";
import { isSDKOutdated } from "shared/sdk-versioning";
import { HiOutlineExclamationCircle } from "react-icons/hi";
import { SchemaFormat } from "@back-end/types/datasource";
import { DocSection } from "@/components/DocLink";
import Tooltip from "@/components/Tooltip/Tooltip";

export type LanguageFilter =
  | "popular"
  | "all"
  | "browser"
  | "server"
  | "mobile"
  | "edge"
  | "essential";
export type LanguageType =
  | "frontend"
  | "backend"
  | "mobile"
  | "edge"
  | "nocode"
  | "other";
export type LanguageLogo = {
  Icon: IconType;
  color: string;
  label: string;
  docLabel?: string;
  docs: DocSection;
  type: string;
  filters: LanguageFilter[];
  hideVersion?: boolean;
  extra?: ReactElement | string;
};
export const languageMapping: Record<
  Exclude<SchemaFormat, "mixpanel" | "custom">,
  LanguageLogo
> = {
  ga4: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Google Analytics v4",
    docs: "google_analytics",
    type: "other",
    filters: [],
    hideVersion: true,
  },
  segment: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Segment",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  snowplow: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Snowplow",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  jitsu: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Jitsu",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  freshpaint: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Freshpaint",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  fullstory: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Fullstory",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  matomo: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Matomo",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  heap: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Heap",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  rudderstack: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Rudderstack",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  amplitude: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Amplitude",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  mparticle: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "mparticle",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  firebase: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "Firebase",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  keen: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "keen io",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
  clevertap: {
    Icon: SiGoogleanalytics,
    color: "#E37400",
    label: "CleverTap",
    docs: "mixpanel",
    type: "",
    filters: [],
    hideVersion: undefined,
    extra: undefined,
  },
};

export default function DataSourceLogo({
  language,
  showLabel = false,
  size = 25,
  titlePrefix = "",
}: {
  language: SchemaFormat;
  showLabel?: boolean;
  size?: number;
  titlePrefix?: string;
}) {
  if (!Object.keys(languageMapping).includes(language)) {
    return null;
  }
  const { Icon, color, label } = languageMapping[language];

  return (
    <span className="d-inline-flex align-items-center position-relative">
      <Icon
        style={{ color, height: size, fontSize: size, lineHeight: size }}
        className="m-0"
        title={titlePrefix + label}
      />
      <span className="ml-2">{showLabel && label}</span>
    </span>
  );
}

export function getLanguagesByFilter(
  languageFilter: LanguageFilter = "all"
): SDKLanguage[] {
  return Object.entries(languageMapping)
    .filter(([_, language]) => {
      if (languageFilter === "all") return true;
      return language.filters.includes(languageFilter);
    })
    .map((o) => o[0]) as SDKLanguage[];
}

export function getConnectionLanguageFilter(
  languages: SDKLanguage[]
): LanguageFilter {
  const languageFilters = new Set<LanguageFilter>();
  languages.forEach((language) => {
    const type = languageMapping?.[language]?.type;
    if (type) {
      languageFilters.add(
        type
          // todo: only use filters (not types) to make this consistent
          .replace("frontend", "browser")
          .replace("nocode", "browser")
          .replace("backend", "server")
          .replace("other", "all") as LanguageFilter
      );
    }
  });
  if (languageFilters.size === 0) {
    return "popular";
  }
  if (languageFilters.size === 1) {
    return [...languageFilters][0];
  }
  return "all";
}
