import { getRaidNameFromHash } from '../bungie/manifest';

const ACTIVITY_MODE_NAMES: Record<number, string> = {
    2: 'Story',
    3: 'Strike',
    4: 'Raid',
    5: 'All PvP',
    6: 'Patrol',
    7: 'All PvE',
    10: 'Control',
    12: 'Clash',
    15: 'Crimson Doubles',
    16: 'Nightfall',
    17: 'Heroic Nightfall',
    18: 'All Strikes',
    19: 'Iron Banner',
    31: 'Supremacy',
    37: 'Survival',
    38: 'Countdown',
    39: 'Trials of the Nine',
    40: 'Social',
    41: 'Trials Countdown',
    42: 'Trials Survival',
    43: 'Iron Banner Control',
    44: 'Iron Banner Clash',
    45: 'Iron Banner Supremacy',
    46: 'Scored Nightfall',
    48: 'Rumble',
    49: 'All Doubles',
    50: 'Doubles',
    51: 'Private Match Clash',
    52: 'Private Match Control',
    53: 'Private Match Supremacy',
    54: 'Private Match Countdown',
    55: 'Private Match Survival',
    56: 'Private Match Mayhem',
    57: 'Private Match Rumble',
    58: 'Heroic Adventure',
    59: 'Showdown',
    60: 'Lockdown',
    61: 'Scorched',
    62: 'Scorched Team',
    63: 'Gambit',
    64: 'All PvE Competitive',
    65: 'Breakthrough',
    66: 'Black Armory Run',
    67: 'Salvage',
    69: 'PvP Competitive',
    70: 'PvP Quickplay',
    71: 'Clash Quickplay',
    72: 'Clash Competitive',
    73: 'Control Quickplay',
    74: 'Control Competitive',
    75: 'Gambit Prime',
    76: 'Reckoning',
    77: 'Menagerie',
    78: 'Vex Offensive',
    79: 'Nightmare Hunt',
    80: 'Elimination',
    81: 'Momentum',
    82: 'Dungeon',
    83: 'Sundial',
    84: 'Trials of Osiris',
    85: 'Dares of Eternity',
};

const IN_ORBIT_MODE_HASHES = new Set<number>([
    2166136261, // Transitory mode hash observed for in-orbit players
]);

export function getActivityModeName(modeType?: number | null): string {
    if (!modeType) return 'Unknown Activity';
    return ACTIVITY_MODE_NAMES[modeType] || `Activity Mode ${modeType}`;
}

export function getActivityDisplayName(
    activityHash: number,
    modeType?: number | null,
    modeHash?: number | null
): string {
    const raidName = getRaidNameFromHash(activityHash);
    if (raidName !== 'Unknown Raid') {
        return raidName;
    }
    if (!modeType && modeHash && IN_ORBIT_MODE_HASHES.has(modeHash)) {
        return 'In Orbit';
    }
    return getActivityModeName(modeType);
}
