// Turbopack (next build/dev) and Vite (vitest) both implement import.meta.glob.
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options: { eager: true; import?: string },
  ): Record<string, T>;
}
