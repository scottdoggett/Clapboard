/**
 * Convex Authentication Helpers
 *
 * Helper functions for handling user authentication with Clerk.
 * Phase 4 feature — currently a stub.
 *
 * Authentication flow:
 * 1. User authenticates via Clerk in the popup
 * 2. Clerk JWT is sent to Convex
 * 3. Convex validates the JWT and creates/retrieves user record
 */

import { QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Get the currently authenticated user from the context
 *
 * @param _ctx - Convex query or mutation context (unused until Clerk is wired up)
 * @returns User document or null if not authenticated
 */
export async function getCurrentUser(_ctx: QueryCtx | MutationCtx) {
  // TODO: Implement Clerk authentication
  // const identity = await ctx.auth.getUserIdentity();
  // if (!identity) return null;
  //
  // return await ctx.db
  //   .query("users")
  //   .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
  //   .first();

  return null;
}

/**
 * Require authentication — throws if user is not logged in
 *
 * @param ctx - Convex query or mutation context
 * @returns User document
 * @throws Error if not authenticated
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);

  if (!user) {
    throw new Error("Authentication required");
  }

  return user;
}

/**
 * Create or update user record from Clerk identity
 *
 * @param ctx - Convex mutation context
 * @param identity - Clerk identity object
 * @returns User document ID
 */
export async function upsertUser(
  ctx: MutationCtx,
  identity: {
    subject: string;
    email?: string;
    name?: string;
  }
) {
  // Check if user exists
  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .first();

  if (existingUser) {
    // Update existing user if needed
    // TODO: Add update logic if email/name changed
    return existingUser._id;
  }

  // Create new user
  return await ctx.db.insert("users", {
    clerkId: identity.subject,
    email: identity.email || "",
    name: identity.name,
    createdAt: Date.now(),
  });
}

/**
 * Verify that a request is coming from a valid extension context
 * (Additional security layer for sensitive operations)
 *
 * @param ctx - Convex context
 * @returns boolean indicating if request is valid
 */
export function verifyExtensionContext(_ctx: QueryCtx | MutationCtx): boolean {
  // TODO: Implement extension verification
  // This could check for a special header or token set by the extension
  return true;
}
