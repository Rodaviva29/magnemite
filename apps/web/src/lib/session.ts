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

export async function getSession(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
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
