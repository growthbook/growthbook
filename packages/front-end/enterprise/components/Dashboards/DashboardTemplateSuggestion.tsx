import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { DashboardInterface } from "shared/enterprise";
import { Box, Flex } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";

type TemplateMetadata = {
  id: string;
  name: string;
  description: string;
};

type ListResponse = {
  status: number;
  templates: TemplateMetadata[];
};

type CreateResponse = {
  status: number;
  dashboard: DashboardInterface;
};

type Props = {
  datasource: DataSourceInterfaceWithParams;
};

// Dismissible callout shown on the datasource detail page when one or more
// built-in dashboard templates are eligible for the datasource. Clicking
// "Create Dashboard" instantiates the template via the backend and routes
// the user to the new dashboard.
//
// The dismissed state is keyed per-(user, datasource) via the underlying
// Callout's `dismissible` + `id` props which persist to localStorage.
const DashboardTemplateSuggestion: React.FC<Props> = ({ datasource }) => {
  const { apiCall } = useAuth();
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateMetadata[] | null>(null);
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTemplates(null);
    setError(null);
    apiCall<ListResponse>(
      `/dashboards/templates?datasourceId=${encodeURIComponent(datasource.id)}`,
      { method: "GET" },
    )
      .then((res) => {
        if (cancelled) return;
        setTemplates(res.templates ?? []);
      })
      .catch(() => {
        // Suggestion is opportunistic; fail quietly if the endpoint is
        // unavailable. Users can still create dashboards manually.
        if (cancelled) return;
        setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [apiCall, datasource.id]);

  const createFromTemplate = useCallback(
    async (templateId: string) => {
      setError(null);
      setCreatingTemplateId(templateId);
      try {
        const res = await apiCall<CreateResponse>("/dashboards/from-template", {
          method: "POST",
          body: JSON.stringify({
            templateId,
            datasourceId: datasource.id,
          }),
        });
        if (res.dashboard?.id) {
          router.push(`/product-analytics/dashboards/${res.dashboard.id}`);
        } else {
          setError("Failed to create dashboard from template");
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message || "Failed to create dashboard from template");
      } finally {
        setCreatingTemplateId(null);
      }
    },
    [apiCall, datasource.id, router],
  );

  if (!templates || templates.length === 0) return null;

  return (
    <Box mb="3">
      <Callout
        status="info"
        dismissible
        id={`dashboardTemplateSuggestion:${datasource.id}`}
      >
        <Flex direction="column" gap="2">
          <Text weight="medium">
            Get started faster with a pre-built dashboard
          </Text>
          <Text>
            We can create a starter dashboard based on this data source. You can
            edit any chart afterwards.
          </Text>
          <Flex direction="column" gap="2" mt="1">
            {templates.map((template) => (
              <Flex
                key={template.id}
                align="center"
                justify="between"
                gap="3"
                wrap="wrap"
              >
                <Box style={{ flex: 1, minWidth: 240 }}>
                  <Text weight="medium">{template.name}</Text>{" "}
                  <Text color="text-mid">— {template.description}</Text>
                </Box>
                <Button
                  size="xs"
                  onClick={() => createFromTemplate(template.id)}
                  loading={creatingTemplateId === template.id}
                  disabled={creatingTemplateId !== null}
                >
                  Create Dashboard
                </Button>
              </Flex>
            ))}
          </Flex>
          {error ? (
            <Text size="small" as="div">
              <span style={{ color: "var(--red-11)" }}>{error}</span>
            </Text>
          ) : null}
        </Flex>
      </Callout>
    </Box>
  );
};

export default DashboardTemplateSuggestion;
