import { generateToken, hashToken, prisma, syncAdminFromEnv, tokenPrefix } from "../src/index.js";

type SeedFeed = { name: string; indexUrl: string; baseUrl: string | null; priority: number };

/**
 * The two starter sources this optional seed adds. Sources live in the
 * database and are otherwise fully managed from Settings — add, edit, or
 * remove as many as you like there; this is just a convenient starting point.
 */
const KNOWN_FEEDS: SeedFeed[] = [
  {
    name: "UnownHash mirror",
    indexUrl: "https://mirror.unownhash.com/index.json",
    // The index lists filenames only, and the files live under /apks/.
    baseUrl: "https://mirror.unownhash.com/apks/",
    priority: 100,
  },
  {
    name: "Silva (The Treeline Project)",
    indexUrl: "https://the-treeline-project.github.io/p/silva/index.json",
    baseUrl: null,
    priority: 200,
  },
];

async function main() {
  await syncAdminFromEnv();
  console.log(`admin user: ${process.env.ADMIN_EMAIL ?? "admin@example.com"}`);

  // Where builds are discovered. Every source publishes the same index shape;
  // more can be added from Settings, and the lowest priority decides whose URL
  // is downloaded when two of them list the same build.
  //
  // Created before the target, because the target has to be paired with them:
  // a target polls only the feeds it is given, so one seeded without any would
  // never discover a thing.
  const feeds = KNOWN_FEEDS;

  const feedRows = [];
  for (const feed of feeds) {
    feedRows.push(
      await prisma.sourceFeed.upsert({
        where: { name: feed.name },
        update: {},
        create: feed,
      }),
    );
  }
  console.log(`source feeds: ${feeds.map((f) => f.name).join(", ")}`);

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

  // Both feeds, which is what a single-app fleet wants. Re-running the seed
  // must not unpair anything an operator has since unticked, so this only ever
  // adds.
  await prisma.appTargetSource.createMany({
    data: feedRows.map((feed) => ({ appTargetId: appTarget.id, feedId: feed.id })),
    skipDuplicates: true,
  });
  console.log(`app target: ${appTarget.packageName} (${feedRows.length} sources)`);

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
