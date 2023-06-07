import React from "react";
import { NextPage } from "next";
import { PersonalAccessTokensContainer } from "@/components/PersonalAccessTokens/PersonalAccessTokens";

const PersonalAccessTokensPage: NextPage = () => {
  return (
    <div className="container pagecontents">
      <PersonalAccessTokensContainer />
    </div>
  );
};

export default PersonalAccessTokensPage;
