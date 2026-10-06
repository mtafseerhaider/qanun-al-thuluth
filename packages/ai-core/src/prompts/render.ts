/** Mustache-style `{{name}}` rendering. Missing variables throw so prompts never ship with holes. */
export function renderPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Missing prompt variable: ${name}`);
    return String(value);
  });
}
