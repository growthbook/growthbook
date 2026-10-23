import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import { useSettingsNav } from "@/components/Layout/SettingsNavContext";
import { useSettingsForm } from "./SettingsFormProvider";
import {
  matchesSettingsQuery,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "./settingsSections";
import styles from "./SettingsSection.module.scss";

// Ids of the cards matching the current query, or null when there is no query.
const SectionMatchContext = createContext<Set<string> | null>(null);

export default function SettingsSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const def = SETTINGS_SECTIONS.find((s) => s.id === id);
  const { query, setCount } = useSettingsNav();
  const { dirtySectionIds } = useSettingsForm();
  const ref = useRef<HTMLElement>(null);
  const [matched, setMatched] = useState<Set<string> | null>(null);

  // Cards match on their rendered text plus `data-keywords`, so no field needs annotating.
  useEffect(() => {
    const tokens = tokenizeSettingsQuery(query);
    if (!tokens.length) {
      setMatched(null);
      setCount(id, null);
      return;
    }
    const hits = new Set<string>();
    ref.current
      ?.querySelectorAll<HTMLElement>("[data-settings-card]")
      .forEach((el) => {
        const hay = [el.textContent, el.dataset.keywords, def?.title].join(" ");
        if (matchesSettingsQuery(hay, tokens))
          hits.add(el.dataset.settingsCard!);
      });
    setMatched(hits);
    setCount(id, hits.size);
    return () => setCount(id, null);
  }, [query, id, def?.title, setCount]);

  if (!def) return null;

  return (
    <section
      id={id}
      ref={ref}
      aria-labelledby={`${id}-heading`}
      className={styles.section}
      hidden={matched !== null && matched.size === 0}
    >
      <Flex align="center" gap="3" wrap="wrap" className={styles.header}>
        <h2 id={`${id}-heading`} className={styles.title}>
          {def.title}
        </h2>
        {matched && matched.size > 0 && (
          <Badge
            color="violet"
            variant="soft"
            label={`${matched.size} match${matched.size === 1 ? "" : "es"}`}
          />
        )}
        {dirtySectionIds.includes(id) && (
          <Badge color="amber" variant="soft" label="Unsaved" />
        )}
      </Flex>
      <p className={styles.description}>{def.description}</p>
      <SectionMatchContext.Provider value={matched}>
        {children}
      </SectionMatchContext.Provider>
    </section>
  );
}

/** Searchable unit inside a SettingsSection. Hidden when a query is set and it does not match. */
export function SettingsCard({
  id,
  keywords,
  children,
}: {
  id: string;
  keywords?: string;
  children: ReactNode;
}) {
  const matched = useContext(SectionMatchContext);
  return (
    <div
      data-settings-card={id}
      data-keywords={keywords}
      hidden={matched !== null && !matched.has(id)}
    >
      {children}
    </div>
  );
}
