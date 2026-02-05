/**
 * Scoring Utilities
 *
 * Helper functions for normalizing and processing ratings
 * from different sources to a common scale.
 */

import type { Rating, RatingSource } from "@shared/types/movie";
import { RATING_SOURCES } from "@shared/constants";

/**
 * Normalize a score to a 0-100 scale
 *
 * @param score - The raw score value
 * @param maxScore - The maximum possible score for this source
 * @returns Normalized score from 0-100
 */
export function normalizeScore(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  const normalized = (score / maxScore) * 100;
  return Math.round(Math.min(100, Math.max(0, normalized)));
}

/**
 * Calculate average score from multiple ratings
 *
 * @param ratings - Array of ratings from different sources
 * @returns Average normalized score (0-100) or null if no ratings
 */
export function calculateAverageScore(ratings: Rating[]): number | null {
  if (ratings.length === 0) return null;

  const normalizedScores = ratings.map((r) => normalizeScore(r.score, r.maxScore));
  const sum = normalizedScores.reduce((acc, score) => acc + score, 0);

  return Math.round(sum / normalizedScores.length);
}

/**
 * Calculate weighted average score
 * Different sources can have different weights based on reliability/popularity
 *
 * @param ratings - Array of ratings from different sources
 * @param weights - Optional weight multipliers per source
 * @returns Weighted average normalized score (0-100) or null if no ratings
 */
export function calculateWeightedScore(
  ratings: Rating[],
  weights: Partial<Record<RatingSource, number>> = {}
): number | null {
  if (ratings.length === 0) return null;

  // Default weights (can be adjusted based on preference)
  const defaultWeights: Record<RatingSource, number> = {
    IMDb: 1.0,
    RottenTomatoes: 1.0,
    Metacritic: 1.0,
    Letterboxd: 1.0,
  };

  const effectiveWeights = { ...defaultWeights, ...weights };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const rating of ratings) {
    const weight = effectiveWeights[rating.source] || 1.0;
    const normalizedScore = normalizeScore(rating.score, rating.maxScore);
    weightedSum += normalizedScore * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;

  return Math.round(weightedSum / totalWeight);
}

/**
 * Get score tier/grade based on normalized score
 *
 * @param normalizedScore - Score on 0-100 scale
 * @returns Tier label
 */
export function getScoreTier(normalizedScore: number): string {
  if (normalizedScore >= 90) return "Exceptional";
  if (normalizedScore >= 75) return "Great";
  if (normalizedScore >= 60) return "Good";
  if (normalizedScore >= 50) return "Mixed";
  if (normalizedScore >= 35) return "Poor";
  return "Bad";
}

/**
 * Get color class based on normalized score
 *
 * @param normalizedScore - Score on 0-100 scale
 * @returns Tailwind color class
 */
export function getScoreColorClass(normalizedScore: number): string {
  if (normalizedScore >= 75) return "cb-text-green-400";
  if (normalizedScore >= 50) return "cb-text-yellow-400";
  return "cb-text-red-400";
}

/**
 * Format a rating for display
 *
 * @param rating - Rating object
 * @returns Formatted string (e.g., "8.5/10" or "92%")
 */
export function formatRating(rating: Rating): string {
  const source = RATING_SOURCES[rating.source];

  // Percentage-based sources
  if (source.maxScore === 100) {
    return `${Math.round(rating.score)}%`;
  }

  // 10-point scale (IMDb)
  if (source.maxScore === 10) {
    return `${rating.score.toFixed(1)}/10`;
  }

  // 5-star scale (Letterboxd)
  if (source.maxScore === 5) {
    return `${rating.score.toFixed(1)}/5`;
  }

  // Fallback
  return `${rating.score}/${rating.maxScore}`;
}

/**
 * Sort ratings by source priority for display
 *
 * @param ratings - Array of ratings
 * @returns Sorted array with most popular sources first
 */
export function sortRatingsByPriority(ratings: Rating[]): Rating[] {
  const priority: RatingSource[] = ["IMDb", "RottenTomatoes", "Metacritic", "Letterboxd"];

  return [...ratings].sort((a, b) => {
    const priorityA = priority.indexOf(a.source);
    const priorityB = priority.indexOf(b.source);
    return priorityA - priorityB;
  });
}
