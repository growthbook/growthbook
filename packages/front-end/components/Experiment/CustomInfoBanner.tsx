import clsx from "clsx";

const CustomInfoBanner = () => {
  // To enable this component, set NEXT_PUBLIC_RESULTS_CUSTOM_INFO_BANNER to true
  // You can access internal models and hooks here as well, for example:
  // const { experiment } = useSnapshot();
  // const orgSettings = useOrgSettings();
  return (
    <div
      className={clsx("alert mb-0 rounded-0", {
        "alert-info": true,
      })}
    >
      <a>Add a custom info banner here!</a>
    </div>
  );
};

export default CustomInfoBanner;
