import { PiCaretRightFill } from "react-icons/pi";
import Text from "@/ui/Text";
import styles from "./RequestDetails.module.scss";

// The held request's query and body, collapsed until asked for.
export default function RequestDetails({ json }: { json: string }) {
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>
        <PiCaretRightFill className={styles.caret} />
        <Text weight="semibold">Request details</Text>
      </summary>
      <pre className={styles.json}>{json}</pre>
    </details>
  );
}
