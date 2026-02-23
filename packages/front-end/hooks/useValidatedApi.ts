import { ZodObject } from "zod";
import useApi, { UseApiOptions } from "./useApi";

export default function useValidatedApi<Response = unknown>(
  path: string,
  schema: ZodObject,
  {
    shouldRun,
    autoRevalidate = true,
    orgScoped = true,
    refreshInterval,
  }: UseApiOptions = {},
) {
  const response = useApi<Response>(path, {
    shouldRun,
    autoRevalidate,
    orgScoped,
    refreshInterval,
  });

  if (!response.data || response.error) {
    return response;
  }

  const { data, ...rest } = response;

  const parsedData = schema.safeParse(data);
  if (!parsedData.success && parsedData.error) {
    console.error(
      "Error parsing API response with useValidatedApi: ",
      parsedData.error.message,
    );
  }
  return { data: parsedData.data as Response, ...rest };
}
