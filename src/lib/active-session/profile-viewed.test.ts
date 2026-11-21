import { describe, expect, it } from 'vitest';
import { profileViewedBody } from './profile-viewed';

/**
 * When the profile page asks the crawler to look, and what the request carries (#9003, #9004): the
 * viewed player's id and type, at most one teammate's, and no other field.
 */

const VIEWED = { membershipId: '4611686018488940001', membershipType: 3 };
const MATE = { membershipId: '4611686018488940002', membershipType: 1 };

describe('profileViewedBody', () => {
    it('names only the viewed player when the raid was read from their own profile', () => {
        expect(profileViewedBody(VIEWED, false, { from: 'self' }, false)).toEqual(VIEWED);
    });

    it('adds the teammate the raid was read from, with their type', () => {
        expect(profileViewedBody(VIEWED, false, { from: 'teammate', teammate: MATE }, false)).toEqual({ ...VIEWED, teammate: MATE });
    });

    it('carries nothing but ids and flags, even if the objects handed in carry more', () => {
        const noisy = { ...VIEWED, displayName: 'Anything#0000' };
        const mate = { ...MATE, displayName: 'Other#1111' };
        const body = profileViewedBody(noisy, false, { from: 'teammate', teammate: mate }, true);
        expect(body).toEqual({ ...VIEWED, teammate: MATE, history: false });
        expect(Object.keys(body!.teammate!).sort()).toEqual(['membershipId', 'membershipType']);
    });

    it('asks for the poll for a stored session even when the browser found no raid', () => {
        expect(profileViewedBody(VIEWED, true, null, false)).toEqual(VIEWED);
    });

    it('asks for the history crawl alone for a player with no stored session and no raid', () => {
        expect(profileViewedBody(VIEWED, false, null, false)).toEqual({ ...VIEWED, poll: false });
    });

    it('asks for the poll without the history crawl for an account-wide-private player with a raid or a session', () => {
        expect(profileViewedBody(VIEWED, true, null, true)).toEqual({ ...VIEWED, history: false });
        expect(profileViewedBody(VIEWED, false, { from: 'teammate', teammate: MATE }, true))
            .toEqual({ ...VIEWED, teammate: MATE, history: false });
    });

    it('sends nothing for an account-wide-private player with no stored session and no raid', () => {
        expect(profileViewedBody(VIEWED, false, null, true)).toBeNull();
    });
});
