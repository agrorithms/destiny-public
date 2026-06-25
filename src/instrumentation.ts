import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Start the leaderboard cache warmer in the long-lived web process.
    // Self-guards on WARMER_ENABLED and a globalThis singleton.
    const { startLeaderboardWarmer } = await import("./lib/cache/warmer");
    startLeaderboardWarmer();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
