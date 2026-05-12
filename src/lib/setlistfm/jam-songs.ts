// Jam canon song list — songs from the core jam tradition.
// Any band playing these is a meaningful signal of a jam/Dead-adjacent act.
// Imports the GD set and layers in Phish, Widespread Panic, Allman Brothers, and Gov't Mule.
// All lowercase for case-insensitive matching.

import { GD_SONGS, HIGH_SIGNAL_GD_SONGS, normalizeSetlistSong } from './gd-songs'

const PHISH_SONGS = new Set([
  // Phish originals — very distinctive, rarely covered by non-jam acts
  'you enjoy myself',
  'yem',
  'reba',
  'tweezer',
  'tweezer reprise',
  'harry hood',
  'run like an antelope',
  'antelope',
  'down with disease',
  'bathtub gin',
  'stash',
  'chalk dust torture',
  'chalkdust torture',
  'bouncing around the room',
  'character zero',
  'sample in a jar',
  'wolfman\'s brother',
  'free',
  'farmhouse',
  'guyute',
  'fluffhead',
  'llama',
  'maze',
  'possum',
  'sparkle',
  'the landlady',
  'julius',
  'punch you in the eye',
  'cavern',
  'split open and melt',
  'theme from the bottom',
  'ghost',
  'simple',
  'lawn boy',
  'fast enough for you',
  'slave to the traffic light',
  'slave',
  'the lizards',
  'foam',
  'waste',
  'dirt',
  'the divided sky',
  'divided sky',
  'wilson',
  'fee',
  'conduit street',
  'run like an antelope',
  'sneakin\' sally through the alley',
  'uncle pen',
  'steam',
  'blaze on',
  'big black furry creature from mars',
  'bbfcfm',
  'contact',
  'colonel forbin\'s ascent',
  'the famous mockingbird',
  'esther',
  'the squirming coil',
  'squirming coil',
  'mcgrupp and the watchful hosemasters',
  'hydrogen',
  'weekapaug groove',
  'my sweet one',
  'golgi apparatus',
  'golgi',
  'suzy greenberg',
  'mound',
  'mango song',
  'lizards',
  'rhombus narration',
])

const HIGH_SIGNAL_PHISH_SONGS = new Set([
  'you enjoy myself',
  'yem',
  'reba',
  'tweezer',
  'harry hood',
  'run like an antelope',
  'the divided sky',
  'divided sky',
  'fluffhead',
  'split open and melt',
])

const WIDESPREAD_PANIC_SONGS = new Set([
  'space wrangler',
  'chilly water',
  'can\'t get it wrong',
  'fishwater',
  'porch song',
  'diner',
  'travelin\' light',
  'wondering',
  'bear\'s gone fishin',
  'bears gone fishin',
  'this part of town',
  'mercy',
  'barstools and dreamers',
  'stop-go',
  'stop go',
  'lets make this right',
  'let\'s make this right',
  'driving song',
  'give',
  'climb to safety',
  'blackout blues',
  'junior',
])

const HIGH_SIGNAL_WIDESPREAD = new Set([
  'space wrangler',
  'chilly water',
  'fishwater',
])

const ALLMAN_BROTHERS_SONGS = new Set([
  'in memory of elizabeth reed',
  'elizabeth reed',
  'whipping post',
  'jessica',
  'blue sky',
  'melissa',
  'mountain jam',
  'one way out',
  'statesboro blues',
  'trouble no more',
  'little martha',
  'ramblin\' man',
  'ramblin man',
  'eat a peach',
  'southbound',
  'soul shine',
  'soulshine',
  'revival',
  'come and go blues',
  'done somebody wrong',
  'jelly jelly',
])

const HIGH_SIGNAL_ALLMAN = new Set([
  'in memory of elizabeth reed',
  'elizabeth reed',
  'whipping post',
  'jessica',
  'mountain jam',
])

const GOVT_MULE_SONGS = new Set([
  'thorazine shuffle',
  'mule',
  'sco-mule',
  'birth of the mule',
  'banks of the deep end',
  'larger than life',
  'beautifully broken',
  'blind man in the dark',
  'life before insanity',
  'trane',
  'bad little doggie',
  'lowrider',
  'world in your eyes',
  'painted silver light',
])

// The complete jam canon — union of all the above sets plus GD
export const JAM_SONGS: Set<string> = new Set([
  ...GD_SONGS,
  ...PHISH_SONGS,
  ...WIDESPREAD_PANIC_SONGS,
  ...ALLMAN_BROTHERS_SONGS,
  ...GOVT_MULE_SONGS,
])

export const HIGH_SIGNAL_JAM_SONGS: Set<string> = new Set([
  ...HIGH_SIGNAL_GD_SONGS,
  ...HIGH_SIGNAL_PHISH_SONGS,
  ...HIGH_SIGNAL_WIDESPREAD,
  ...HIGH_SIGNAL_ALLMAN,
])

export function isJamSong(title: string): boolean {
  return JAM_SONGS.has(normalizeSetlistSong(title))
}

export function isHighSignalJamSong(title: string): boolean {
  return HIGH_SIGNAL_JAM_SONGS.has(normalizeSetlistSong(title))
}

export { normalizeSetlistSong }
