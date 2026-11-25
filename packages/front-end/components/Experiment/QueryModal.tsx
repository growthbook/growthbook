import { FC } from "react";
import { QueryLanguage } from "shared/types/datasource";
import { useLingui } from "@lingui/react/macro";
import Modal from "@/components/Modal";
import Code from "@/components/SyntaxHighlighting/Code";

const QueryModal: FC<{
  queries: string[];
  language: QueryLanguage;
  close: () => void;
}> = ({ queries, language, close }) => {
  const { t } = useLingui();
  return (
    <Modal
      trackingEventModalType=""
      close={close}
      header={t`View Query`}
      open={true}
      size="max"
      closeCta={t`Close`}
    >
      {queries.map((query, i) => (
        <Code language={language} key={i} code={query} />
      ))}
    </Modal>
  );
};

export default QueryModal;
