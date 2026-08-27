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

type SeedFeed = { name: string; indexUrl: string; baseUrl: string | null; priority: number };

/**
 * The sources a fresh install starts with.
 *
 * `MIRROR_INDEX_URL` takes a comma-separated list, so a deployment can seed
 * whichever indexes it wants without editing this file. Known ones keep their
 * name and, where the index lists bare filenames, the base URL those need;
 * anything else is named after its host and gets no base URL, which is right
 * for an index that publishes an absolute `url` per entry. If it does not, set
 * the base URL in Settings — the Health card says so when entries have nowhere
 * to download from.
 */
const KNOWN_FEEDS: Record<string, Omit<SeedFeed, "priority">> = {
  "https://mirror.unownhash.com/index.json": {
    name: "UnownHash mirror",
    indexUrl: "https://mirror.unownhash.com/index.json",
    // The index lists filenames only, and the files live under /apks/.
    baseUrl: "https://mirror.unownhash.com/apks/",
  },
  "https://the-treeline-project.github.io/p/silva/index.json": {
    name: "Silva (The Treeline Project)",
    indexUrl: "https://the-treeline-project.github.io/p/silva/index.json",
    baseUrl: null,
  },
};

const DEFAULT_INDEX_URLS = Object.keys(KNOWN_FEEDS);

function sourceFeeds(): SeedFeed[] {
  const configured = (process.env.MIRROR_INDEX_URL ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const urls = configured.length > 0 ? configured : DEFAULT_INDEX_URLS;

  return urls.map((indexUrl, index) => {
    const known = KNOWN_FEEDS[indexUrl];
    if (known) return { ...known, priority: (index + 1) * 100 };

    let name = indexUrl;
    try {
      name = new URL(indexUrl).host;
    } catch {
      // Left as the raw string: a bad URL is better shown back than hidden.
    }
    return { name, indexUrl, baseUrl: null, priority: (index + 1) * 100 };
  });
}

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
      // Off until the operator has watched one manual rollout go through.
      autoUpdateEnabled: false,
      autoApprove: false,
      canaryCount: 1,
      soakMinutes: 30,
      maxAttempts: 3,
    },
  });
  console.log(`app target: ${appTarget.packageName}`);

  // Where builds are discovered. Every source publishes the same index shape;
  // more can be added from Settings, and the lowest priority decides whose URL
  // is downloaded when two of them list the same build.
  const feeds = sourceFeeds();

  for (const feed of feeds) {
    await prisma.sourceFeed.upsert({
      where: { name: feed.name },
      update: {},
      create: feed,
    });
  }
  console.log(`source feeds: ${feeds.map((f) => f.name).join(", ")}`);

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
