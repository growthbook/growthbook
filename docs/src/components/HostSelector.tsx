import React, { useEffect, useState } from "react";

let currentHost = "cloud";
let currentCustomDomain = "";

const HOST_KEY = "gbHost";
const CUSTOM_DOMAIN_KEY = "gbCustomDomain";

function initializeHost() {
  try {
    const host = localStorage.getItem(HOST_KEY);
    if (host) currentHost = host;
  } catch (e) {
    // Ignore localStorage errors
  }

  try {
    const domain = localStorage.getItem(CUSTOM_DOMAIN_KEY);
    if (domain) currentCustomDomain = domain;
  } catch (e) {
    // Ignore localStorage errors
  }
}

function fireDomEvent() {
  const event = new CustomEvent("gbHostChange");
  window.dispatchEvent(event);
}

export function useGrowthBookHost() {
  const [host, updateHost] = useState(getGrowthBookHost());

  useEffect(() => {
    const listener = () => {
      updateHost(getGrowthBookHost());
    };
    window.addEventListener("gbHostChange", listener);
    return () => {
      window.removeEventListener("gbHostChange", listener);
    };
  }, []);

  return host;
}

export default function HostSelector() {
  initializeHost();

  const [host, setRawHost] = useState(currentHost);
  const setHost = (host: string) => {
    try {
      localStorage.setItem(HOST_KEY, host);
    } catch (e) {
      // Ignore localStorage errors
    }
    currentHost = host;
    setRawHost(host);
    fireDomEvent();
  };

  const [customDomain, setRawCustomDomain] = useState(currentCustomDomain);
  const setCustomDomain = (domain: string) => {
    try {
      localStorage.setItem(CUSTOM_DOMAIN_KEY, domain);
    } catch (e) {
      // Ignore localStorage errors
    }
    currentCustomDomain = domain;
    setRawCustomDomain(domain);
    fireDomEvent();
  };

  return (
    <div style={{ display: "flex" }}>
      <label style={{ marginRight: "5px" }}>
        GrowthBook Host:{" "}
        <select
          value={host}
          onChange={(e) => setHost(e.target.value)}
          style={{
            padding: "5px",
            borderRadius: "5px",
          }}
        >
          <option value="cloud">Cloud</option>
          <option value="localhost">Localhost</option>
          <option value="custom">Custom Domain</option>
        </select>
      </label>
      {host === "custom" && (
        <input
          value={customDomain}
          type="url"
          onChange={(e) => setCustomDomain(e.target.value)}
          placeholder="https://..."
          style={{
            borderRadius: "5px",
            padding: "5px",
          }}
        />
      )}
    </div>
  );
}

function getGrowthBookHost() {
  initializeHost();

  if (currentHost === "custom" && currentCustomDomain) {
    let domain = currentCustomDomain.replace(/\/$/, "");
    if (!domain.startsWith("http")) {
      domain = "https://" + domain;
    }
    return domain;
  }
  if (currentHost === "localhost") {
    return "http://localhost:3000";
  }
  return "https://app.growthbook.io";
}
