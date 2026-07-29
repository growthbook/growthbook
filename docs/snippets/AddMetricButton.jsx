export const rowFilterOperators = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "is_null",
  "not_null",
  "is_true",
  "is_false",
  "sql_expr",
  "saved_filter",
];

export const AddMetricButton = ({ data }) => {
  let currentHost = "cloud";
  let currentCustomDomain = "";

  const HOST_KEY = "gbHost";
  const CUSTOM_DOMAIN_KEY = "gbCustomDomain";

  const ExternalLink = () => {
    return (
      <svg width="13.5" height="13.5" aria-hidden="true" viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M21 13v10h-21v-19h12v2h-10v15h17v-8h2zm3-12h-10.988l4.035 4-6.977 7.07 2.828 2.828 6.977-7.07 4.125 4.172v-11z"
        ></path>
      </svg>
    );
  };

  const useGrowthBookHost = () => {
    const initializeHost = () => {
      try {
        const host = localStorage.getItem(HOST_KEY);
        if (host) currentHost = host;
      } catch (e) {}
      try {
        const domain = localStorage.getItem(CUSTOM_DOMAIN_KEY);
        if (domain) currentCustomDomain = domain;
      } catch (e) {}
    };

    const getGrowthBookHost = () => {
      initializeHost();
      if (currentHost === "custom" && currentCustomDomain) {
        let domain = currentCustomDomain.replace(/\/$/, "");
        if (!domain.startsWith("http")) domain = "https://" + domain;
        return domain;
      }
      if (currentHost === "localhost") return "http://localhost:3000";
      return "https://app.growthbook.io";
    };

    const [host, updateHost] = useState(getGrowthBookHost());

    useEffect(() => {
      const listener = () => updateHost(getGrowthBookHost());
      window.addEventListener("gbHostChange", listener);
      return () => window.removeEventListener("gbHostChange", listener);
    }, []);

    return host;
  };

  const host = useGrowthBookHost();

  const url = `${host}/metrics?addMetric=${encodeURIComponent(JSON.stringify(data))}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-center justify-center shrink-0 select-none align-top not-italic text-center rounded-md bg-[#6e56cf] !text-white text-base leading-6 py-2 px-4 font-medium border-0 hover:border-b-0"
    >
      <span className="mr-1.5 group-hover:underline">Add to GrowthBook</span> <ExternalLink />
    </a>
  );
};
