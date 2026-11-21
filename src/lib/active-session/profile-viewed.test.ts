import { describe, expect, it } from 'vitest';
import { profileViewedBody } from './profile-viewed';

/**
 * When the profile page asks the crawler to look, and what the request carries (#9003): the
 * viewed player's id and type, at most one teammate's, and no other field.
 */

const VIEWED = { membershipId: '4611686018488940001', membershipType: 3 };
const MATE = { membershipId: '4611686018488940002', membershipType: 1 };

describe('profileViewedBody', () => {
    it('names only the viewed player when the raid was read from their own profile', () => {
        expect(profileViewedBody(VIEWED, false, { from: 'self' })).toEqual(VIEWED);
    });

    it('adds the teammate the raid was read from, with their type', () => {
        expect(profileViewedBody(VIEWED, false, { from: 'teammate', teammate: MATE })).toEqual({ ...VIEWED, teammate: MATE });
    });

    it('carries nothing but ids, even if the objects handed in carry more', () => {
        const noisy = { ...VIEWED, displayName: 'Anything#0000' };
        const mate = { ...MATE, displayName: 'Other#1111' };
        const body = profileViewedBody(noisy, false, { from: 'teammate', teammate: mate });
        expect(body).toEqual({ ...VIEWED, teammate: MATE });
        expect(Object.keys(body!).sort()).toEqual(['membershipId', 'membershipType', 'teammate']);
        expect(Object.keys(body!.teammate!).sort()).toEqual(['membershipId', 'membershipType']);
    });

    it('sends for a stored session even when the browser found no raid, so the crawler re-checks it', () => {
        expect(profileViewedBody(VIEWED, true, null)).toEqual(VIEWED);
    });

    it('still names the teammate when the stored baseline had a session too', () => {
        expect(profileViewedBody(VIEWED, true, { from: 'teammate', teammate: MATE })).toEqual({ ...VIEWED, teammate: MATE });
    });

    it('sends nothing for a player with no stored session and no raid', () => {
        expect(profileViewedBody(VIEWED, false, null)).toBeNull();
    });
});
