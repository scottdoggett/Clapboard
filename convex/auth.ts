/**
 * Authentication
 *
 * Convex Auth with the password provider, which is the only option here that
 * needs no third-party account: sign-up and sign-in run entirely against this
 * deployment. The keys live in the deployment's environment (`JWT_PRIVATE_KEY`,
 * `JWKS`), set by `npx @convex-dev/auth`.
 *
 * Signing in is optional. Everything the extension does works signed out —
 * ratings, awards, and a personal library held in `chrome.storage`. An account
 * buys one thing: that library following you to another browser or surviving a
 * reinstall. That framing matters, because it means nothing here may become a
 * gate in front of the parts that already work.
 */

import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});

/**
 * The signed-in user's id, or null.
 *
 * @param ctx - Query or mutation context
 * @returns The user id, or null when signed out
 */
export async function currentUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users"> | null> {
  return await getAuthUserId(ctx);
}

/**
 * The signed-in user's id, or an error.
 *
 * Used by every function that reads or writes personal data, so a bug can't
 * quietly return one person's watchlist to another: without a caller there is
 * no data to return, and saying so is safer than returning an empty list that
 * looks like "you have nothing saved".
 *
 * @param ctx - Query or mutation context
 * @returns The user id
 * @throws When nobody is signed in
 */
export async function requireUserId(
  ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);

  if (!userId) {
    throw new Error("Not signed in");
  }

  return userId;
}
