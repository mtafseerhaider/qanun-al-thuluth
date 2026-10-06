/** `T` with `undefined` removed from optional values, matching `exactOptionalPropertyTypes`. */
export type DefinedOnly<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * Drops keys whose value is `undefined`. Zod output types mark optional fields `T | undefined`, which
 * the generated Insert/Update types reject under `exactOptionalPropertyTypes`.
 */
export function definedOnly<T extends object>(value: T): DefinedOnly<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as DefinedOnly<T>;
}
