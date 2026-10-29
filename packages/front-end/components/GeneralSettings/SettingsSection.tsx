import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box, Flex } from "@radix-ui/themes";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { useSettingsNav } from "@/components/Layout/SettingsNavContext";
import { useSettingsForm } from "./SettingsFormProvider";
import {
  matchesSettingsQuery,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "./settingsSections";
import styles from "./SettingsSection.module.scss";

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
    const compute = () => {
      const hits = new Set<string>();
      ref.current
        ?.querySelectorAll<HTMLElement>("[data-settings-card]")
        .forEach((el) => {
          const hay = [el.textContent, el.dataset.keywords, def?.title].join(
            " ",
          );
          if (matchesSettingsQuery(hay, tokens))
            hits.add(el.dataset.settingsCard!);
        });
      setMatched((prev) =>
        prev && prev.size === hits.size && [...hits].every((h) => prev.has(h))
          ? prev
          : hits,
      );
      setCount(id, hits.size);
    };
    compute();
    // Cards that load later (e.g. AI prompts) re-run the match.
    const observer = new MutationObserver(compute);
    if (ref.current)
      observer.observe(ref.current, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    return () => {
      observer.disconnect();
      setCount(id, null);
    };
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
        <Heading as="h2" size="lg" m="0">
          <span id={`${id}-heading`}>{def.title}</span>
        </Heading>
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
      <Box maxWidth="680px" mt="2" mb="4">
        <Text as="p" color="text-mid" m="0">
          {def.description}
        </Text>
      </Box>
      <SectionMatchContext.Provider value={matched}>
        {children}
      </SectionMatchContext.Provider>
    </section>
  );
}

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
      id={id}
      data-settings-card={id}
      data-keywords={keywords}
      hidden={matched !== null && !matched.has(id)}
    >
      {children}
    </div>
  );
}
