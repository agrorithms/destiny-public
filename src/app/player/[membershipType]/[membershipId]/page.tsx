// Server wrapper: mints a short-lived page token (server-only PAGE_TOKEN_SECRET) and hands it
// to the client component, which echoes it as the x-page-token header on its client-write POSTs
// (active-session-update, identity, queue-crawl). This route is dynamic (per-id params), so the
// token is freshly minted on each navigation. See src/lib/http/request-auth.ts.
import { mintPageToken } from '@/lib/http/request-auth';
import PlayerProfileClient from './PlayerProfileClient';

export default function PlayerProfilePage() {
    return <PlayerProfileClient pageToken={mintPageToken()} />;
}
