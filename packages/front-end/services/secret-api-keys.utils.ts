import { ApiKeyInterface } from "back-end/types/apikey";

type GroupedApiKeys = {
  secret: ApiKeyInterface[];
  user: ApiKeyInterface[];
  readonly: ApiKeyInterface[];
};

/**
 * The GET /keys endpoint returns all kinds of API keys.
 * For the new API keys, we only care about the following criteria:
 *  - Only include secret keys
 *  - Secret keys have no type
 *  - User keys have type 'user'
 *  - Read-only keys have type 'read-only'
 * @param apiKeys List of {@link ApiKeyInterface}
 */
export function groupApiKeysByType(apiKeys: ApiKeyInterface[]): GroupedApiKeys {
  const grouped: GroupedApiKeys = {
    secret: [],
    user: [],
    readonly: [],
  };

  return apiKeys
    .filter((apiKey) => apiKey.secret === true)
    .reduce<GroupedApiKeys>((previousValue, currentValue) => {
      switch (currentValue.type) {
        case "read-only":
          grouped.readonly.push(currentValue);
          break;

        case "user":
          grouped.user.push(currentValue);
          break;

        default:
          grouped.secret.push(currentValue);
      }

      return previousValue;
    }, grouped);
}
