import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export { PrismaClient };

// A single client per process. Next.js dev reloads the module graph on every
// edit, which would otherwise open a new pool each time until Postgres runs
// out of connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Issuer Better Auth stamps on email/password accounts. Anything that writes a
 * credential row — the seed, the admin account form — has to use it, because
 * sign-in looks the account up by (issuer, accountId).
 */
export const CREDENTIAL_ISSUER = "local:credential";
export const CREDENTIAL_PROVIDER_ID = "credential";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/// Device and enrollment tokens are 32 random bytes, so a plain sha256 is
/// enough to store them — there is nothing to brute-force. Passwords use
/// bcrypt instead.
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/// Prisma returns BigInt for byte counts, which `JSON.stringify` refuses to
/// serialize and React refuses to render. Every byte count we store fits in a
/// double (a 9 PB device would be a surprise), so widen them on the way out.
export function serialize<T>(value: T): SerializedBigInt<T> {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v)),
  ) as SerializedBigInt<T>;
}

export type SerializedBigInt<T> = T extends bigint
  ? number
  : T extends Date
    ? string
    : T extends (infer U)[]
      ? SerializedBigInt<U>[]
      : T extends object
        ? { [K in keyof T]: SerializedBigInt<T[K]> }
        : T;
