import React from "react";
import { NextPage } from "next";
import { PersonalAccessTokensContainer } from "@/components/PersonalAccessTokens/PersonalAccessTokens";
import { ConnectedAppsContainer } from "@/components/ConnectedApps/ConnectedApps";

const PersonalAccessTokensPage: NextPage = () => {
  return (
    <div className="container pagecontents">
      <PersonalAccessTokensContainer />
      <ConnectedAppsContainer />
    </div>
  );
};

export default PersonalAccessTokensPage;
