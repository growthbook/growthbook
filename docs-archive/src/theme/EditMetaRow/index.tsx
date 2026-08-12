// eslint-disable-next-line import/no-unresolved
import EditThisPage from "@theme/EditThisPage";
import type { Props } from "@theme/EditMetaRow";

import FeedbackWidget from "../../components/FeedbackWidget";
import styles from "./styles.module.css";

export default function EditMetaRow({ editUrl }: Props) {
  return (
    <div className={styles.docFooter}>
      <div>{editUrl && <EditThisPage editUrl={editUrl} />}</div>
      <FeedbackWidget />
    </div>
  );
}
