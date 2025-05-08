export async function getTranslations() {
  const supportedLanguages = ["en", "pt"];
  const promises = supportedLanguages.map(async (lang) => {
    const res = await fetch(`/locales/${lang}/common.json`);
    const json = await res.json();
    return json;
  });
  const translations = await Promise.all(promises);
  return supportedLanguages.reduce((acc, lang, index) => {
    return {
      ...acc,
      [lang]: {
        translation: translations[index],
      },
    };
  }, {});
}
