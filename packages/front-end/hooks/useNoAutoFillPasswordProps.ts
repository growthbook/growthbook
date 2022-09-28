import { CSSProperties, useCallback, useState } from "react";
import uniqId from "uniqid";

type NoAutoFillPasswordProps = {
  name: string;
  readOnly: boolean;
  onFocus: () => void;
  onBlur: () => void;
  autoComplete: string;
  style: CSSProperties;
};

/**
 * This is a hack to remove Chrome's autofill password prompt.
 * This will need to be used on both username and password fields, in separate implementations.
 * Learn why here: https://developer.mozilla.org/en-US/docs/Web/Security/Securing_your_site/Turning_off_form_autocompletion#the_autocomplete_attribute_and_login_fields
 * Appropriate usages:
 *    - data source forms to prevent sending GrowthBook credentials to third-parties
 *      - Fields: username, password, database
 * Inappropriate usages (do not use for):
 *    - GrowthBook login forms
 */
export const useNoAutoFillPasswordProps = (): NoAutoFillPasswordProps => {
  const [readOnly, setReadOnly] = useState(true);

  const onFocus = useCallback(() => {
    setTimeout(() => {
      setReadOnly(false);
    }, 300);
  }, []);

  const onBlur = useCallback(() => {
    setReadOnly(true);
  }, []);

  return {
    autoComplete: "new-password",
    style: { backgroundColor: "white" },
    readOnly,
    name: uniqId(),
    onBlur,
    onFocus,
  };
};
