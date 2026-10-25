import { describe, expect, it } from 'vitest';
import { MAX_RAIDS, parseActivityRaids, pickRaids, raidColour } from './activity-raids';
import { activityRangeHref } from './activity-range';

/**
 * The raids the Raid Activity page draws (#198): which `?raids=` keys count, which raids the
 * bottom panel shows when the URL names none, and the colour of each. A reader must see the
 * same panel from a shared link, so these pin exactly what a bad link falls back to.
 */
const KNOWN = ['salvations_edge', 'kings_fall', 'vault_of_glass', 'last_wish', 'crotas_end', 'root_of_nightmares', 'deep_stone_crypt'];

describe('parseActivityRaids', () => {
    it('reads the comma-separated raid keys in the order the URL gives them', () => {
        expect(parseActivityRaids({ raids: 'last_wish,salvations_edge' }, KNOWN)).toEqual(['last_wish', 'salvations_edge']);
    });

    it('reads a single key', () => {
        expect(parseActivityRaids({ raids: 'kings_fall' }, KNOWN)).toEqual(['kings_fall']);
    });

    it('drops keys it does not know, and empty segments', () => {
        expect(parseActivityRaids({ raids: 'nope,kings_fall,,Last_Wish,last_wish' }, KNOWN)).toEqual(['kings_fall', 'last_wish']);
    });

    it('keeps a raid once, where its first mention put it', () => {
        expect(parseActivityRaids({ raids: 'last_wish,kings_fall,last_wish' }, KNOWN)).toEqual(['last_wish', 'kings_fall']);
    });

    it('cuts more than five to the first five, counting only the keys it kept', () => {
        // The unknown key is dropped first, so it does not use up one of the five.
        const raids = parseActivityRaids({ raids: 'nope,' + KNOWN.join(',') }, KNOWN);
        expect(MAX_RAIDS).toBe(5);
        expect(raids).toEqual(KNOWN.slice(0, 5));
    });

    it('is empty — so the default applies — when the key is missing, empty, repeated or has nothing it knows', () => {
        expect(parseActivityRaids({}, KNOWN)).toEqual([]);
        expect(parseActivityRaids({ raids: '' }, KNOWN)).toEqual([]);
        expect(parseActivityRaids({ raids: ['last_wish', 'kings_fall'] }, KNOWN)).toEqual([]);
        expect(parseActivityRaids({ raids: 'nope,also_nope' }, KNOWN)).toEqual([]);
    });
});

describe('pickRaids', () => {
    it('draws the URL\'s raids when it names any', () => {
        expect(pickRaids(['last_wish'], ['kings_fall', 'crotas_end'], KNOWN)).toEqual(['last_wish']);
    });

    it('draws the top raids in the range, in their order, when the URL names none', () => {
        expect(pickRaids([], ['kings_fall', 'crotas_end', 'last_wish'], KNOWN)).toEqual(['kings_fall', 'crotas_end', 'last_wish']);
    });

    it('skips a top raid it has no name for', () => {
        expect(pickRaids([], ['mystery_raid', 'kings_fall'], KNOWN)).toEqual(['kings_fall']);
    });

    it('draws nothing when no raid has run in the range and the URL names none', () => {
        expect(pickRaids([], [], KNOWN)).toEqual([]);
    });
});

describe('raidColour', () => {
    it('gives each of the five positions its own series token', () => {
        const colours = Array.from({ length: MAX_RAIDS }, (_, index) => raidColour(index));
        expect(new Set(colours).size).toBe(MAX_RAIDS);
        expect(colours[0]).toBe('var(--ui-series-1)');
        expect(colours[4]).toBe('var(--ui-series-5)');
    });
});

describe('the link to a range with raids', () => {
    it('spells the raids out after the range when it is given some', () => {
        expect(activityRangeHref('30d', ['last_wish', 'kings_fall'])).toBe('/activity?range=30d&raids=last_wish,kings_fall');
    });

    it('is the range alone when it is given none', () => {
        expect(activityRangeHref('24h', [])).toBe('/activity?range=24h');
    });
});
