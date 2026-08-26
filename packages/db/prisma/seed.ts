import bcrypt from "bcryptjs";
import {
  CREDENTIAL_ISSUER,
  CREDENTIAL_PROVIDER_ID,
  generateToken,
  hashToken,
  prisma,
  tokenPrefix,
} from "../src/index.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "change-me-please";

async function main() {
  // Better Auth keeps credentials on the account row, not the user. The auth
  // config points its hasher at bcrypt precisely so this seed can create the
  // first admin without importing Better Auth here.
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN" },
    create: {
      email: ADMIN_EMAIL,
      name: "Admin",
      emailVerified: true,
      role: "ADMIN",
    },
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const credential = await prisma.account.findFirst({
    where: { userId: admin.id, providerId: CREDENTIAL_PROVIDER_ID },
  });

  if (credential) {
    // Re-running the seed resets the admin password to whatever ADMIN_PASSWORD
    // currently says, which is the escape hatch for a lost login.
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
  console.log(`admin user: ${admin.email}`);

  const appTarget = await prisma.appTarget.upsert({
    where: { packageName: "com.nianticlabs.pokemongo" },
    update: {},
    create: {
      packageName: "com.nianticlabs.pokemongo",
      displayName: "Pokémon GO",
      githubRepo: process.env.GITHUB_REPO ?? "The-Treeline-Project/Silva-Releases",
      // Matches googleplaystore_<build>_<ver>_com.nianticlabs.pokemongo_arm64-v8a.apkm
      // and skips the loose base.apk / dump.cs / metadata assets in the release.
      assetPattern: "^googleplaystore_.*_com\\.nianticlabs\\.pokemongo_arm64-v8a\\.apkm$",
      mirrorIndexUrl: process.env.MIRROR_INDEX_URL ?? "https://mirror.unownhash.com/index.json",
      mirrorBaseUrl: process.env.MIRROR_BASE_URL ?? "https://mirror.unownhash.com/apks/",
      preferredSource: "MIRROR",
      // Off until the operator has watched one manual rollout go through.
      autoUpdateEnabled: false,
      autoApprove: false,
      canaryCount: 1,
      soakMinutes: 30,
      maxAttempts: 3,
    },
  });
  console.log(`app target: ${appTarget.packageName}`);

  const group = await prisma.deviceGroup.upsert({
    where: { name: "default" },
    update: {},
    create: {
      name: "default",
      preInstallHook: "am force-stop com.nianticlabs.pokemongo",
      postInstallHook: "",
    },
  });
  console.log(`device group: ${group.name}`);

  // Only mint an enrollment token on a fresh database. Re-running the seed
  // must not invalidate the token already flashed onto the fleet.
  const existingTokens = await prisma.enrollmentToken.count({ where: { revoked: false } });
  if (existingTokens === 0) {
    const token = generateToken();
    await prisma.enrollmentToken.create({
      data: {
        label: "initial",
        tokenHash: hashToken(token),
        prefix: tokenPrefix(token),
        autoApprove: true,
      },
    });
    console.log("");
    console.log("enrollment token (shown once, put it in the agent config):");
    console.log(`  ${token}`);
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
