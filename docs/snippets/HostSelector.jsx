export const HostSelector = () => {
  let currentHost = "cloud";
  let currentCustomDomain = "";

  const HOST_KEY = "gbHost";
  const CUSTOM_DOMAIN_KEY = "gbCustomDomain";

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

  const fireDomEvent = () => window.dispatchEvent(new CustomEvent("gbHostChange"));

  initializeHost();

  const [host, setRawHost] = useState(currentHost);
  const setHost = (host) => {
    try {
      localStorage.setItem(HOST_KEY, host);
    } catch (e) {}
    currentHost = host;
    setRawHost(host);
    fireDomEvent();
  };

  const [customDomain, setRawCustomDomain] = useState(currentCustomDomain);
  const setCustomDomain = (domain) => {
    try {
      localStorage.setItem(CUSTOM_DOMAIN_KEY, domain);
    } catch (e) {}
    currentCustomDomain = domain;
    setRawCustomDomain(domain);
    fireDomEvent();
  };

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        GrowthBook Host:
        <div className="relative">
          <select
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="appearance-none bg-white dark:bg-[#1e2124] text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 pr-8 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          >
            <option value="cloud">Cloud</option>
            <option value="localhost">Localhost</option>
            <option value="custom">Custom Domain</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 dark:text-gray-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </label>
      {host === "custom" && (
        <input
          value={customDomain}
          type="url"
          onChange={(e) => setCustomDomain(e.target.value)}
          placeholder="https://..."
          className="bg-white dark:bg-[#1e2124] text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
        />
      )}
    </div>
  );
};
