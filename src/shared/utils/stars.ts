/**
 * Star Rating Maths
 *
 * How much of each star is filled for a given score. Trivial arithmetic with
 * boundaries that are easy to get wrong by one half-step, and getting it wrong
 * means someone's own rating is displayed back to them incorrectly — so it
 * lives here where it can be checked rather than inside the component.
 */

export type StarFill = "empty" | "half" | "full";

/** Stars shown, which is also the top of the scale. */
export const STAR_COUNT = 10;

/**
 * How full the star at `index` should be.
 *
 * @param score - The rating, 0-10 in halves
 * @param index - Zero-based star position
 */
export function fillFor(score: number, index: number): StarFill {
  if (score >= index + 1) return "full";
  if (score >= index + 0.5) return "half";
  return "empty";
}

/**
 * The whole row's fills, for a score.
 */
export function starRow(score: number): StarFill[] {
  return Array.from({ length: STAR_COUNT }, (_, index) => fillFor(score, index));
}

/**
 * What clicking a half-star target should produce.
 *
 * Clicking the value already selected clears it — otherwise there is no way
 * back to unrated once a rating has been given.
 *
 * @param current - The score now, or undefined
 * @param clicked - The value under the pointer
 * @returns The new score, or undefined for unrated
 */
export function nextScore(
  current: number | undefined,
  clicked: number
): number | undefined {
  return current === clicked ? undefined : clicked;
}
