This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Destiny Farm Finder

Track who is farming raids right now. See real-time leaderboards of the most completed raid activities in the past few hours, and browse active raid sessions across Destiny 2.

## Fireteam Finder

The app now includes a first-pass `/fireteam-finder` page that reads public Fireteam Finder listings from Bungie's API.

For now, Bungie's Fireteam Finder browse endpoints are wired through Bungie OAuth. Add these environment variables before using the page:

```bash
BUNGIE_CLIENT_ID=...
BUNGIE_CLIENT_SECRET=...
APP_ORIGIN=https://127.0.0.1:3000
# optional override if you want to set the full callback explicitly
# BUNGIE_REDIRECT_URI=https://127.0.0.1:3000/api/auth/bungie/callback
```

The page currently focuses on:

- Listing active public postings
- Filtering listings by activity hash
- Mapping activity hashes to names through the local manifest cache

Next steps can build on this foundation for post creation, applications, and joining once OAuth/account flows are in place.

As of March 28, 2026, a live probe against Bungie's Fireteam Finder browse endpoint returned `WebAuthRequired` when called with only an API key, so authenticated user context is required for this page to return real listings.

### Bungie OAuth redirect URL

For the current local HTTPS server in this repo, register this exact redirect URL with Bungie:

`https://127.0.0.1:3000/api/auth/bungie/callback`

If you change the app origin or deploy to production, the registered redirect URL must be updated to the exact callback URL for that environment. Bungie requires a single exact redirect URL match.
