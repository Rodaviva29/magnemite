import "server-only";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@magnemite/db";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The public origin the dashboard is reached on.
 *
 * Better Auth needs this: without it, it derives the origin from whatever Host
 * header arrives, and behind a proxy that silently breaks callbacks and
 * redirects. Coolify does not hand it over in one fixed shape — the domain
 * lands in the container as `SERVICE_FQDN_WEB` (and `SERVICE_URL_WEB`), which
 * may or may not carry a scheme, so a bare host is normalised rather than
 * rejected. `BETTER_AUTH_URL` and `MAGNEMITE_DASHBOARD_URL` come first so an
 * explicit setting always wins.
 */
function resolveDashboardOrigin(): string | undefined {
  const candidate = [
    process.env.BETTER_AUTH_URL,
    process.env.MAGNEMITE_DASHBOARD_URL,
    process.env.SERVICE_FQDN_WEB,
    process.env.SERVICE_URL_WEB,
  ]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));

  if (!candidate) return undefined;

  const host = candidate.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  if (!host) return undefined;
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const scheme = /^https?:\/\//i.test(candidate)
    ? candidate.slice(0, candidate.indexOf("://") + 3)
    : isLoopback
      ? "http://"
      : "https://";

  try {
    return new URL(`${scheme}${host}`).origin;
  } catch {
    return undefined;
  }
}

/**
 * Better Auth, wired to whichever database DB_PROVIDER points Prisma at
 * (`postgresql` by default; `mysql` covers MariaDB too — see
 * `@magnemite/db`'s prisma.config.ts).
 *
 * Two deliberate choices:
 *
 *  - Sign-up is disabled. This is an internal tool for a known set of
 *    operators; accounts are created from Settings by an admin, never by
 *    whoever finds the login page.
 *  - Passwords are hashed with bcrypt rather than Better Auth's default
 *    scrypt, so `pnpm db:seed` can create the first admin without pulling
 *    Better Auth into the database package.
 */
function createAuth() {
  const dashboardOrigin = resolveDashboardOrigin();
  // Better Auth's adapter provider names match Prisma's, so DB_PROVIDER
  // passes straight through.
  const dbProvider = process.env.DB_PROVIDER === "mysql" ? "mysql" : "postgresql";

  return betterAuth({
    appName: "Magnemite",
    database: prismaAdapter(prisma, { provider: dbProvider }),
    secret: required("AUTH_SECRET"),
    baseURL: dashboardOrigin,
    trustedOrigins: dashboardOrigin ? [dashboardOrigin] : [],

    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      password: {
        hash: (password) => bcrypt.hash(password, 12),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Reading the session on every server render would otherwise be a query
      // per request; the dashboard renders a lot of them.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "VIEWER",
          // Never settable through the auth API — role changes go through the
          // Settings page, which checks the caller is an admin.
          input: false,
        },
      },
    },

    // Must stay last: it is what lets a server action set the session cookie.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Built on first use rather than at import.
 *
 * `next build` evaluates route modules to collect page data, and constructing
 * Better Auth there would demand AUTH_SECRET at image-build time — a secret
 * that only exists at run time. The proxy keeps every call site written as
 * plain `auth.api.…` while deferring construction to the first request.
 */
let instance: Auth | null = null;

export const auth = new Proxy({} as Auth, {
  get(_target, property, receiver) {
    instance ??= createAuth();
    return Reflect.get(instance, property, receiver);
  },
});
