// `import.meta.glob` é do Vite e não faz parte da biblioteca padrão do TypeScript.
// Usado em lib/server/migrations.ts para embutir os arquivos SQL de migração no bundle.
interface ImportMeta {
  glob<Value = unknown>(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, Value>;
}
