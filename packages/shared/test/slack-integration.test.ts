import { missingSlackBotScopes } from "../src/slack-integration";

describe("missingSlackBotScopes", () => {
  const allScopes =
    "chat:write,files:write,channels:read,groups:read,channels:join,assistant:write,im:history,app_mentions:read,links:read,links:write";

  it.each([undefined, ""])(
    "requires every scope when granted is %p",
    (granted) => {
      expect(missingSlackBotScopes(granted)).toEqual(allScopes.split(","));
    },
  );

  it("identifies missing assistant and unfurl scopes on an older installation", () => {
    expect(
      missingSlackBotScopes(
        "chat:write,files:write,channels:read,groups:read,channels:join",
      ),
    ).toEqual([
      "assistant:write",
      "im:history",
      "app_mentions:read",
      "links:read",
      "links:write",
    ]);
  });

  it("requires reconnecting assistant installations missing unfurl permissions", () => {
    expect(
      missingSlackBotScopes(
        "chat:write,files:write,channels:read,groups:read,channels:join,assistant:write,im:history,app_mentions:read",
      ),
    ).toEqual(["links:read", "links:write"]);
  });

  it("accepts all required scopes and additional grants", () => {
    expect(missingSlackBotScopes(allScopes)).toEqual([]);
    expect(missingSlackBotScopes(`${allScopes},commands`)).toEqual([]);
  });

  it("ignores whitespace, repeated scopes, and a trailing comma", () => {
    expect(
      missingSlackBotScopes(
        ` ${allScopes.replaceAll(",", ", ")} , chat:write,`,
      ),
    ).toEqual([]);
  });
});
