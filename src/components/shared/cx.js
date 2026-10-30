/**
 * Joins module classes and removes the empty ones: `cx(s.a, on && s.b)` → `"a_x b_y"`.
 * @param {...(string | false | null | undefined)} names
 */
export const cx = (...names) => names.filter(Boolean).join(" ");
