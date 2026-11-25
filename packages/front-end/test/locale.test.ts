import { resolveLanguage } from "@/services/locale";

describe("resolveLanguage", () => {
  it("keeps a supported language", () => {
    expect(resolveLanguage("de")).toBe("de");
  });

  it("drops the region from a locale tag", () => {
    expect(resolveLanguage("pt-BR")).toBe("pt");
    expect(resolveLanguage("zh_CN")).toBe("zh");
  });

  it("ignores case", () => {
    expect(resolveLanguage("FR")).toBe("fr");
  });

  it("falls back to English for an unsupported language", () => {
    expect(resolveLanguage("nl")).toBe("en");
  });

  it("falls back to English when nothing is stored", () => {
    expect(resolveLanguage(null)).toBe("en");
    expect(resolveLanguage(undefined)).toBe("en");
    expect(resolveLanguage("")).toBe("en");
  });
});
