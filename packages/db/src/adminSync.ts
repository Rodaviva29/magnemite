import bcrypt from "bcryptjs";
import { CREDENTIAL_ISSUER, CREDENTIAL_PROVIDER_ID, prisma } from "./index.js";

/**
 * Upserts the admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
 *
 * Called on every hub boot, so the login always tracks the env vars — change
 * `ADMIN_PASSWORD` and restart the hub, no seed step needed. Also called from
 * the optional seed script, so `pnpm db:seed` stays in sync with the same
 * logic rather than duplicating it.
 */
export async function syncAdminFromEnv(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.ADMIN_PASSWORD ?? "change-me-please";

  // Better Auth keeps credentials on the account row, not the user. The auth
  // config points its hasher at bcrypt precisely so this can create/update the
  // admin without importing Better Auth here.
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN" },
    create: {
      email,
      name: "Admin",
      emailVerified: true,
      role: "ADMIN",
    },
  });

  const passwordHash = await bcrypt.hash(password, 12);
  const credential = await prisma.account.findFirst({
    where: { userId: admin.id, providerId: CREDENTIAL_PROVIDER_ID },
  });

  if (credential) {
    await prisma.account.update({
      where: { id: credential.id },
      data: { password: passwordHash, issuer: CREDENTIAL_ISSUER },
    });
  } else {
    await prisma.account.create({
      data: {
        userId: admin.id,
        issuer: CREDENTIAL_ISSUER,
        providerId: CREDENTIAL_PROVIDER_ID,
        accountId: admin.id,
        password: passwordHash,
      },
    });
  }
}
