import React from "react";
import useApi from "@/hooks/useApi";

export default function SDKWebhooks() {
  const { data, mutate } = useApi("/sdk-webhooks");

  return (
    <div className="gb-sdk-connections-webhooks">
      <table className="table mb-3 appbox gbtable">
        <thead>
          <tr>WEBHOOK</tr>
          <tr>ENDPOINT</tr>
          <tr>SEND PAYLOAD</tr>
          <tr>SHARED SECRET</tr>
          <tr>SDKS</tr>
          <tr>STATUS</tr>
        </thead>
      </table>
    </div>
  );
}
