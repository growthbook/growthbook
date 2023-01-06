import React from "react";
import SDKConnectionsList from "@/components/Features/SDKConnections/SDKConnectionsList";

export default function SDKsPage() {
  // TODO: Add tabs to switch between SDK Connections and legacy SDK Endpoints / Webhooks
  return (
    <div className="container">
      <SDKConnectionsList />
    </div>
  );
}
