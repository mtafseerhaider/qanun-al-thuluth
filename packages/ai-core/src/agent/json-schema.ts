import type { z } from 'zod';

import type { JsonSchema } from '../types.ts';

/**
 * Minimal Zod (v3) to JSON Schema conversion for tool input schemas (12 §8: the provider schema is
 * generated from Zod so the reviewable contract and the validator cannot drift). Covers the subset
 * the tool catalog uses: objects, strings (uuid, date, date-time, min/max), numbers (int, min/max),
 * booleans, enums, literals, arrays, unions, optional, nullable and default.
 */

interface Check {
  kind: string;
  value?: number;
  inclusive?: boolean;
}

interface Def {
  typeName: string;
  checks?: Check[];
  values?: readonly (string | number)[];
  value?: unknown;
  type?: z.ZodTypeAny;
  innerType?: z.ZodTypeAny;
  schema?: z.ZodTypeAny;
  options?: readonly z.ZodTypeAny[] | Map<unknown, z.ZodTypeAny>;
  shape?: () => Record<string, z.ZodTypeAny>;
  description?: string;
  minLength?: { value: number } | null;
  maxLength?: { value: number } | null;
  defaultValue?: () => unknown;
}

const defOf = (s: z.ZodTypeAny): Def => (s as unknown as { _def: Def })._def;

function isOptional(s: z.ZodTypeAny): boolean {
  const t = defOf(s).typeName;
  return t === 'ZodOptional' || t === 'ZodDefault';
}

export function zodToJson(s: z.ZodTypeAny): Record<string, unknown> {
  const d = defOf(s);
  const out = convert(s);
  if (d.description && out.description === undefined) out.description = d.description;
  return out;
}

function convert(s: z.ZodTypeAny): Record<string, unknown> {
  const d = defOf(s);
  switch (d.typeName) {
    case 'ZodObject': {
      const shape = d.shape?.() ?? {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJson(v);
        if (!isOptional(v)) required.push(k);
      }
      return {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    }
    case 'ZodString': {
      const o: Record<string, unknown> = { type: 'string' };
      for (const c of d.checks ?? []) {
        if (c.kind === 'uuid') o.format = 'uuid';
        if (c.kind === 'datetime') o.format = 'date-time';
        if (c.kind === 'date') o.format = 'date';
        if (c.kind === 'min') o.minLength = c.value;
        if (c.kind === 'max') o.maxLength = c.value;
      }
      return o;
    }
    case 'ZodNumber': {
      const o: Record<string, unknown> = { type: 'number' };
      for (const c of d.checks ?? []) {
        if (c.kind === 'int') o.type = 'integer';
        if (c.kind === 'min') o[c.inclusive === false ? 'exclusiveMinimum' : 'minimum'] = c.value;
        if (c.kind === 'max') o[c.inclusive === false ? 'exclusiveMaximum' : 'maximum'] = c.value;
      }
      return o;
    }
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: [...(d.values ?? [])] };
    case 'ZodLiteral':
      return { const: d.value };
    case 'ZodArray': {
      const o: Record<string, unknown> = { type: 'array', items: d.type ? zodToJson(d.type) : {} };
      if (d.minLength) o.minItems = d.minLength.value;
      if (d.maxLength) o.maxItems = d.maxLength.value;
      return o;
    }
    case 'ZodOptional':
      return d.innerType ? zodToJson(d.innerType) : {};
    case 'ZodDefault': {
      const inner = d.innerType ? zodToJson(d.innerType) : {};
      return { ...inner, default: d.defaultValue?.() };
    }
    case 'ZodNullable': {
      const inner = d.innerType ? zodToJson(d.innerType) : {};
      if (typeof inner.type === 'string') {
        const res: Record<string, unknown> = { ...inner, type: [inner.type, 'null'] };
        if (Array.isArray(inner.enum)) res.enum = [...(inner.enum as unknown[]), null];
        return res;
      }
      return { anyOf: [inner, { type: 'null' }] };
    }
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const opts = d.options instanceof Map ? [...d.options.values()] : [...(d.options ?? [])];
      return { oneOf: opts.map(zodToJson) };
    }
    case 'ZodEffects':
      return d.schema ? zodToJson(d.schema) : {};
    default:
      return {};
  }
}

/** The tool `inputSchema` for a Zod object. */
export function toolInputSchema(s: z.ZodTypeAny): JsonSchema {
  const json = zodToJson(s);
  if (json.type !== 'object') throw new Error('Tool input schema must be an object');
  return json as JsonSchema;
}
