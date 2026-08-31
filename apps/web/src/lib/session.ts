import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@magnemite/db";
import { auth } from "./auth";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

/**
 * The session, read at most twice.
 *
 * Reading it also renews it: once a session is past `updateAge`, Better Auth
 * writes the row back with a later `expiresAt`. One page load is a burst of
 * parallel reads — every server component, the event stream, each action — so
 * the renewal comes due for all of them at the same instant and they all write
 * the same row at once.
 *
 * MariaDB refuses the losers of that race rather than serialising them (error
 * 1020, "Record has changed since last read", which is snapshot isolation, on
 * by default since 11.6). Better Auth reports a write it could not do as a read
 * it could not do, and a dashboard that cannot read the session is a page that
 * will not render at all.
 *
 * So the second attempt asks not to renew. The request that won the race is
 * already writing exactly what this one wanted written, and a renewal missed is
 * a renewal the next read makes anyway.
 */
async function readSession() {
  const requestHeaders = await headers();
  try {
    return await auth.api.getSession({ headers: requestHeaders });
  } catch {
    return await auth.api.getSession({
      headers: requestHeaders,
      query: { disableRefresh: true },
    });
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const session = await readSession();
  if (!session?.user) return null;

  const user = session.user as typeof session.user & { role?: string | null };
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    // `role` is an additional field, so it comes back loosely typed.
    role: (user.role as UserRole | undefined) ?? "VIEWER",
  };
}

/** Use in every page and server action that must not be reachable logged out. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/**
 * Anything that changes the fleet — starting a rollout, rebooting a box —
 * needs more than read access.
 */
export async function requireOperator(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role === "VIEWER") throw new Error("This account is read-only.");
  return user;
}

/** Creating accounts and changing roles is admin-only. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("This action needs an admin account.");
  return user;
}
