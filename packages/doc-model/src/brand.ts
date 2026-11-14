declare const brand: unique symbol;

/**
 * Nominal typing for primitives: `Brand<string, 'FileId'>` is not assignable
 * from a plain string or from another brand, which prevents mixing up ids.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
