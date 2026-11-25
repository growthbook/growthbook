import { PiCheck, PiTranslate } from "react-icons/pi";
import { Trans } from "@lingui/react/macro";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownSubMenu,
} from "@/ui/DropdownMenu";
import { useLocale } from "@/services/LocaleProvider";
import { languageNativeLabels, supportedLanguages } from "@/services/locale";
import styles from "./TopNav.module.scss";

export default function LanguageMenu({
  standalone = false,
  onSelect,
}: {
  // A menu of its own instead of a submenu inside another dropdown.
  standalone?: boolean;
  onSelect?: () => void;
}) {
  const { language, setLanguage } = useLocale();

  const trigger = (
    <div className="align-middle">
      <PiTranslate size="16" className="mr-1" />
      <Trans>Language</Trans>
    </div>
  );

  const items = supportedLanguages.map((l) => (
    <DropdownMenuItem
      key={l}
      className={styles.dropdownItemIconColor}
      onClick={() => {
        onSelect?.();
        setLanguage(l);
      }}
    >
      <span lang={l}>
        <PiCheck
          size="16"
          className="mr-1"
          style={{ visibility: l === language ? "visible" : "hidden" }}
        />
        {languageNativeLabels[l]}
      </span>
    </DropdownMenuItem>
  ));

  if (standalone) {
    return (
      <DropdownMenu
        trigger={trigger}
        triggerClassName={styles.dropdownItemIconColor}
      >
        {items}
      </DropdownMenu>
    );
  }
  return (
    <DropdownSubMenu
      trigger={trigger}
      triggerClassName={styles.dropdownItemIconColor}
    >
      {items}
    </DropdownSubMenu>
  );
}
