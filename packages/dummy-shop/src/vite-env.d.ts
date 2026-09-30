/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GB_API_HOST?: string;
  readonly VITE_GB_CLIENT_KEY?: string;
  readonly VITE_GB_DECRYPTION_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
