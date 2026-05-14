import { FC } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  ContextualBanditQueryAttributeKind,
  ContextualBanditQueryInterface,
} from "shared/validators";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { FaPlus, FaTrash } from "react-icons/fa";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";

type FormValues = {
  name: string;
  query: string;
  userIdType: string;
  attributes: {
    attribute: string;
    kind: ContextualBanditQueryAttributeKind;
    maxLevels?: number;
  }[];
};

type Props = {
  dataSource: DataSourceInterfaceWithParams;
  close: () => void;
  onCreate: (query: ContextualBanditQueryInterface) => Promise<void>;
};

export const ContextualBanditQueryModal: FC<Props> = ({
  dataSource,
  close,
  onCreate,
}) => {
  const { apiCall } = useAuth();
  const userIdTypes = dataSource.settings?.userIdTypes || [];
  const defaultUserIdType = userIdTypes[0]?.userIdType || "user_id";
  const form = useForm<FormValues>({
    defaultValues: {
      name: "",
      userIdType: defaultUserIdType,
      query: `SELECT\n  ${defaultUserIdType},\n  variation_id,\n  country\nFROM contextual_bandit_assignments`,
      attributes: [
        {
          attribute: "country",
          kind: "categorical",
          maxLevels: 10,
        },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "attributes",
  });
  const attributes = form.watch("attributes");

  const submit = form.handleSubmit(async (value) => {
    const response = await apiCall<{
      contextualBanditQuery: ContextualBanditQueryInterface;
    }>(`/contextual-bandit-queries`, {
      method: "POST",
      body: JSON.stringify({
        name: value.name.trim(),
        datasource: dataSource.id,
        userIdType: value.userIdType,
        query: value.query,
        attributes: value.attributes.map((attribute) => ({
          attribute: attribute.attribute.trim(),
          kind: attribute.kind,
          maxLevels: attribute.maxLevels,
        })),
      }),
    });
    await onCreate(response.contextualBanditQuery);
  });

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      submit={submit}
      close={close}
      size="lg"
      header="Create Contextual Bandit Query"
      cta="Create"
      ctaEnabled={
        !!form.watch("name") &&
        !!form.watch("query") &&
        attributes.every((attribute) => attribute.attribute)
      }
    >
      <Box className="px-2">
        <Field
          label="Name"
          required
          {...form.register("name", { required: true })}
        />
        <Select
          label="User ID Type"
          value={form.watch("userIdType")}
          setValue={(value) => form.setValue("userIdType", value)}
          mb="3"
        >
          {userIdTypes.length ? (
            userIdTypes.map((type) => (
              <SelectItem value={type.userIdType} key={type.userIdType}>
                {type.userIdType}
              </SelectItem>
            ))
          ) : (
            <SelectItem value={defaultUserIdType}>
              {defaultUserIdType}
            </SelectItem>
          )}
        </Select>
        <Field
          label="Query SQL"
          textarea
          minRows={8}
          required
          {...form.register("query", { required: true })}
        />

        <Flex align="center" justify="between" mt="4" mb="2">
          <Text weight="medium">Attributes</Text>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              append({
                attribute: "",
                kind: "categorical",
                maxLevels: 10,
              })
            }
          >
            <FaPlus className="mr-1" /> Add Attribute
          </Button>
        </Flex>

        <Flex direction="column" gap="3">
          {fields.map((field, index) => (
            <Grid key={field.id} columns="2fr 1fr 1fr auto" gap="3">
              <Field
                label={index === 0 ? "Attribute" : undefined}
                placeholder="country"
                required
                {...form.register(`attributes.${index}.attribute`, {
                  required: true,
                })}
              />
              <Select
                label={index === 0 ? "Kind" : undefined}
                value={form.watch(`attributes.${index}.kind`)}
                setValue={(value) =>
                  form.setValue(
                    `attributes.${index}.kind`,
                    value as ContextualBanditQueryAttributeKind,
                  )
                }
              >
                <SelectItem value="categorical">Categorical</SelectItem>
                <SelectItem value="quantitative">Quantitative</SelectItem>
              </Select>
              <Field
                label={index === 0 ? "Max Levels" : undefined}
                type="number"
                min="1"
                max="50"
                {...form.register(`attributes.${index}.maxLevels`, {
                  valueAsNumber: true,
                })}
              />
              <Flex align={index === 0 ? "end" : "center"}>
                <Button
                  type="button"
                  variant="ghost"
                  color="red"
                  disabled={fields.length === 1}
                  onClick={() => remove(index)}
                >
                  <FaTrash />
                </Button>
              </Flex>
            </Grid>
          ))}
        </Flex>
      </Box>
    </ModalStandard>
  );
};
