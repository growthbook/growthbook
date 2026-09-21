import { missingSlackBotScopes } from "../src/slack-integration";

describe("missingSlackBotScopes", () => {
  const allScopes =
    "chat:write,files:write,channels:read,groups:read,channels:join,assistant:write,im:history,app_mentions:read";

  it.each([undefined, ""])(
    "requires every scope when granted is %p",
    (granted) => {
      expect(missingSlackBotScopes(granted)).toEqual(allScopes.split(","));
    },
  );

  it("identifies missing assistant scopes on an older installation", () => {
    expect(
      missingSlackBotScopes(
        "chat:write,files:write,channels:read,groups:read,channels:join",
      ),
    ).toEqual(["assistant:write", "im:history", "app_mentions:read"]);
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
