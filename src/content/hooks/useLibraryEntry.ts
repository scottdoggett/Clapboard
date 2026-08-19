/**
 * useLibraryEntry Hook
 *
 * Reads and updates one title's place in the personal library.
 *
 * Writes are optimistic: a toggle updates on screen immediately and persists
 * behind it. These are single-user, single-device local writes with no
 * possible conflict, and a marking control that lags behind the click feels
 * broken however fast the storage actually is.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getEntry,
  updateEntry,
  applyChange,
  type LibraryEntry,
  type LibrarySubject,
  type Sentiment,
} from "@shared/utils/library";
import { describeChange } from "@shared/utils/toastMessage";
import { showToast } from "../toast";

export interface LibraryControls {
  entry: LibraryEntry | undefined;
  isWatched: boolean;
  isWatchlisted: boolean;
  sentiment: Sentiment | undefined;
  toggleWatched: () => void;
  toggleWatchlist: () => void;
  setSentiment: (value: Sentiment) => void;
  saveReview: (text: string, rating?: number) => void;
}

export function useLibraryEntry(subject: LibrarySubject | null): LibraryControls {
  const [entry, setEntry] = useState<LibraryEntry | undefined>(undefined);

  const identity = subject ? `${subject.imdbId ?? ""}|${subject.title}` : "";

  useEffect(() => {
    if (!subject) {
      setEntry(undefined);
      return;
    }

    let active = true;
    void getEntry(subject).then((found) => {
      if (active) setEntry(found);
    });

    return () => {
      active = false;
    };
    // Keyed on `identity` rather than `subject`. Callers build that object
    // inline, so a new reference arrives every render and depending on it
    // would re-read storage continuously.
  }, [identity]);

  const apply = useCallback(
    (change: Parameters<typeof updateEntry>[1]) => {
      if (!subject) return;

      // Show the result now, persist behind it
      setEntry(applyChange(entry, subject, change, Date.now()) ?? undefined);
      void updateEntry(subject, change).then(setEntry);

      // Confirm at the same moment the button changes, not when storage
      // acknowledges — the write is local and cannot meaningfully fail, and a
      // confirmation that trails the click reads as lag
      const said = describeChange(change);
      if (said) showToast(said);
    },
    [subject, entry]
  );

  return {
    entry,
    isWatched: entry?.watchedAt !== undefined,
    isWatchlisted: entry?.watchlistedAt !== undefined,
    sentiment: entry?.sentiment,
    toggleWatched: () =>
      apply({ watchedAt: entry?.watchedAt === undefined ? Date.now() : undefined }),
    toggleWatchlist: () =>
      apply({ watchlistedAt: entry?.watchlistedAt === undefined ? Date.now() : undefined }),
    // Clicking the sentiment you already chose clears it, the way a thumbs
    // control normally behaves
    setSentiment: (value: Sentiment) =>
      apply({ sentiment: entry?.sentiment === value ? undefined : value }),
    saveReview: (text: string, rating?: number) =>
      apply({
        review:
          text.trim() === "" && rating === undefined
            ? undefined
            : { text: text.trim(), rating, updatedAt: Date.now() },
      }),
  };
}

export default useLibraryEntry;
