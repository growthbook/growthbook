import { action } from "@storybook/addon-actions";
import { DemoDataSourcePage } from "./DemoDataSourcePage";

export default {
  component: DemoDataSourcePage,
  title: "Demo Datasource/DemoDataSourcePage",
};

export const DoesNotExist = () => {
  const onDelete = action("onDelete");
  const onCreate = action("onCreate");

  return (
    <>
      <DemoDataSourcePage
        onDelete={onDelete}
        onCreate={onCreate}
        ready={true}
        exists={false}
        success={false}
      />
    </>
  );
};

export const WasCreatedSuccessfully = () => {
  const onDelete = action("onDelete");
  const onCreate = action("onCreate");

  return (
    <>
      <DemoDataSourcePage
        onDelete={onDelete}
        onCreate={onCreate}
        ready={true}
        exists={true}
        success={true}
      />
    </>
  );
};

export const AlreadyExists = () => {
  const onDelete = action("onDelete");
  const onCreate = action("onCreate");

  return (
    <>
      <DemoDataSourcePage
        onDelete={onDelete}
        onCreate={onCreate}
        ready={true}
        exists={true}
        success={false}
      />
    </>
  );
};

export const Loading = () => {
  const onDelete = action("onDelete");
  const onCreate = action("onCreate");

  return (
    <>
      <DemoDataSourcePage
        onDelete={onDelete}
        onCreate={onCreate}
        ready={false}
        exists={false}
        success={false}
      />
    </>
  );
};
