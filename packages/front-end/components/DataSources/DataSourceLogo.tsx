import React from "react";
import { SchemaFormat } from "back-end/types/datasource";

export type LanguageLogo = {
  logo: string;
  label: string;
};

export const languageMapping: Record<
  Exclude<SchemaFormat, "mixpanel" | "custom">,
  LanguageLogo
> = {
  ga4: {
    logo: "/images/3rd-party-logos/datasource-logos/ga4.svg",
    label: "Google Analytics v4",
  },
  segment: {
    logo: "/images/3rd-party-logos/datasource-logos/segment.svg",
    label: "Segment",
  },
  snowplow: {
    logo: "/images/3rd-party-logos/datasource-logos/snowplow.svg",
    label: "Snowplow",
  },
  jitsu: {
    logo: "/images/3rd-party-logos/datasource-logos/jitsu.svg",
    label: "Jitsu",
  },
  freshpaint: {
    logo: "/images/3rd-party-logos/datasource-logos/freshpaint.svg",
    label: "Freshpaint",
  },
  fullstory: {
    logo: "/images/3rd-party-logos/datasource-logos/fullstory.png",
    label: "Fullstory",
  },
  matomo: {
    logo: "/images/3rd-party-logos/datasource-logos/matomo.svg",
    label: "Matomo",
  },
  heap: {
    logo: "/images/3rd-party-logos/datasource-logos/heap.png",
    label: "Heap",
  },
  rudderstack: {
    logo: "/images/3rd-party-logos/datasource-logos/rudderstack.svg",
    label: "Rudderstack",
  },
  amplitude: {
    logo: "/images/3rd-party-logos/datasource-logos/amplitude.svg",
    label: "Amplitude",
  },
  mparticle: {
    logo: "/images/3rd-party-logos/datasource-logos/mparticle.svg",
    label: "mparticle",
  },
  firebase: {
    logo: "/images/3rd-party-logos/datasource-logos/firebase.svg",
    label: "Firebase",
  },
  keen: {
    logo: "/images/3rd-party-logos/datasource-logos/keen.svg",
    label: "keen io",
  },
  clevertap: {
    logo: "/images/3rd-party-logos/datasource-logos/clevertap.png",
    label: "CleverTap",
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
  const { logo, label } = languageMapping[language];

  return (
    <span className="d-inline-flex align-items-center position-relative">
      <img
        src={logo}
        style={{ height: size, fontSize: size, lineHeight: size }}
        className="m-0"
        title={titlePrefix + label}
      />
      <span className="ml-2">{showLabel && label}</span>
    </span>
  );
}
