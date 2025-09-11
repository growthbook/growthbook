import React from "react";
import { NextPage } from "next";
import ImportFromStatSig from "@/components/importing/ImportFromStatSig/ImportFromStatSig";
import { useFeatureDisabledRedirect } from "@/hooks/useFeatureDisabledRedirect";

const ImportFromStatSigPage: NextPage = () => {
  const { shouldRender } = useFeatureDisabledRedirect("import-from-x");

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="contents container pagecontents">
      <ImportFromStatSig />
    </div>
  );
};

export default ImportFromStatSigPage;
