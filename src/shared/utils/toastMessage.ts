/**
 * Confirmation Wording
 *
 * What to say when a title is marked.
 *
 * These are separate from the thing that draws them because the two callers
 * have nothing else in common — the overlay is React inside one shadow root,
 * the browse tiles are plain DOM in someone else's tree — and because the
 * wording is the part worth getting right. A confirmation that doesn't name
 * what happened ("Saved!") is decoration; one that says "Removed from your
 * watchlist" tells you that you hit the wrong button.
 *
 * Every change carries the field as a present key, so a cleared mark reads as
 * `{ watchedAt: undefined }` rather than as an absent key. That distinction is
 * the whole reason this can tell "unwatched" from "untouched".
 */

import type { LibraryEntry } from "@shared/utils/library";

/** The shape both callers pass to `updateEntry`. */
export type LibraryChange = Partial<
  Pick<LibraryEntry, "watchedAt" | "watchlistedAt" | "sentiment" | "review">
>;

/**
 * Describe what a change did, in the second person and the past tense.
 *
 * @param change - The change that was applied
 * @returns A short confirmation, or null when there is nothing worth saying
 */
export function describeChange(change: LibraryChange): string | null {
  // `in` rather than a truthiness test: clearing a mark sets the field to
  // undefined, and that is exactly the case that most needs confirming
  if ("watchedAt" in change) {
    return change.watchedAt !== undefined ? "Marked as watched" : "No longer watched";
  }

  if ("watchlistedAt" in change) {
    return change.watchlistedAt !== undefined
      ? "Added to your watchlist"
      : "Removed from your watchlist";
  }

  if ("sentiment" in change) {
    if (change.sentiment === "liked") return "Liked";
    if (change.sentiment === "disliked") return "Marked not for me";
    return "Rating removed";
  }

  if ("review" in change) {
    const review = change.review;
    if (!review) return "Review removed";

    // A score with no words is the common case — the stars are right there and
    // the review box is behind a button — so it gets its own wording, and
    // repeats the score back as confirmation that the half-star landed
    if (review.text.trim() === "") {
      return review.rating !== undefined ? `Rated ${review.rating}/10` : "Rating removed";
    }

    return review.rating !== undefined
      ? `Review saved · ${review.rating}/10`
      : "Review saved";
  }

  return null;
}
