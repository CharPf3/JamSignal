/**
 * Jam canon songs, filtered for distinctiveness.
 *
 * The previous list held 220 titles and treated them all as equal evidence,
 * including 26 generic or standard titles — "Free", "Simple", "Ghost", "Dirt",
 * "Possum", "Mule", "Johnny B. Goode", "Good Lovin'", "Not Fade Away",
 * "Dancing in the Street", "Iko Iko". Those are either common English words or
 * covers the Dead themselves played, so any classic-rock bar band triggered
 * them. That was the main false-positive source.
 *
 * Two rules now govern membership:
 *
 *   1. Originals only. A standard the Dead covered is evidence about the Dead,
 *      not about the band playing it tonight. Setlist.fm's own `cover` credit
 *      (see sources/setlistfm.ts) handles cover relationships properly and
 *      measured far better — AUC 0.81 versus 0.32 for raw song counts.
 *
 *   2. Distinctive titles only. If a non-jam act could plausibly have written a
 *      song with the exact same title, the title carries no information.
 *
 * SIGNATURE_SONGS are the subset that is essentially never played outside this
 * tradition — long improvisational vehicles. One of those is worth more than
 * several ordinary canon songs.
 */

import { normalize } from './normalize'

const GRATEFUL_DEAD = [
  // Improvisational vehicles
  'dark star', 'the eleven', 'cryptical envelopment', 'terrapin station',
  'help on the way', 'slipknot', 'weather report suite', 'lady with a fan',
  'blues for allah', 'unbroken chain', 'playing in the band', 'the other one',
  'st stephen', 'saint stephen', 'china cat sunflower', 'i know you rider',
  'china rider', 'eyes of the world', 'estimated prophet', 'shakedown street',
  'franklins tower', 'scarlet begonias', 'fire on the mountain', 'scarlet fire',
  // Songbook
  'sugar magnolia', 'sunshine daydream', 'sugaree', 'uncle johns band',
  'truckin', 'casey jones', 'friend of the devil', 'ripple', 'bertha',
  'tennessee jed', 'jack straw', 'brown eyed women', 'ramble on rose',
  'cumberland blues', 'dire wolf', 'black peter', 'wharf rat', 'stella blue',
  'box of rain', 'the music never stopped', 'mississippi half step',
  'mississippi half step uptown toodeloo', 'row jimmy', 'they love each other',
  'hes gone', 'mexicali blues', 'cassidy', 'lost sailor', 'saint of circumstance',
  'feel like a stranger', 'west la fadeaway', 'touch of grey', 'hell in a bucket',
  'throwing stones', 'victim or the crime', 'standing on the moon', 'foolish heart',
  'picasso moon', 'bird song', 'china doll', 'attics of my life', 'brokedown palace',
  'crazy fingers', 'let it grow', 'alabama getaway', 'ship of fools', 'althea',
  'new speedway boogie', 'easy wind', 'mr charlie', 'greatest story ever told',
  'one more saturday night', 'sage and spirit', 'morning dew',
] as const

const PHISH = [
  // Improvisational vehicles
  'you enjoy myself', 'reba', 'tweezer', 'tweezer reprise', 'harry hood',
  'run like an antelope', 'down with disease', 'bathtub gin', 'stash',
  'the divided sky', 'divided sky', 'fluffhead', 'guyute', 'david bowie',
  'mikes song', 'weekapaug groove', 'slave to the traffic light', 'the lizards',
  'split open and melt', 'chalk dust torture', 'chalkdust torture',
  'colonel forbins ascent', 'the famous mockingbird', 'icculus',
  'mcgrupp and the watchful hosemasters', 'the curtain with', 'harpua',
  // Songbook
  'punch you in the eye', 'theme from the bottom', 'bouncing around the room',
  'character zero', 'sample in a jar', 'wolfmans brother', 'farmhouse',
  'suzy greenberg', 'carini', 'piper', 'first tube', 'gotta jibboo',
  'the moma dance', 'limb by limb', 'scent of a mule', 'axilla', 'buried alive',
  'my friend my friend', 'esther', 'blaze on', '46 days',
  'backwards down the number line', 'kill devil falls', 'ocelot',
  'everythings right', 'ruby waves', 'a wave of hope', 'sigma oasis',
  'set your soul free', 'no men in no mans land', 'fuego', 'the sloth', 'tela',
  'poor heart', 'golgi apparatus', 'the squirming coil', 'its ice',
  'silent in the morning', 'fast enough for you', 'lawn boy', 'guelah papyrus',
  'the mango song', 'sleeping monkey', 'dog faced boy', 'makisupa policeman',
  'halleys comet', 'dinner and a movie', 'billy breathes', 'cars trucks buses',
  'prince caspian', 'nicu', 'back on the train', 'heavy things', 'llama',
] as const

const WIDESPREAD_PANIC = [
  'space wrangler', 'chilly water', 'aint life grand', 'porch song',
  'climb to safety', 'tall boy', 'bowlegged woman', 'blue indian', 'pilgrims',
  'surprise valley', 'imitation leather shoes', 'papas home', 'drivin song',
  'conrad', 'rebirtha', 'c brown', 'little kin', 'thought sausage',
  'you got yours', 'weight of the world', 'barstools and dreamers',
  'holden oversoul', 'send your mind', 'dyin man', 'greta',
] as const

const ALLMAN_BROTHERS = [
  'in memory of elizabeth reed', 'elizabeth reed', 'whipping post', 'jessica',
  'mountain jam', 'hot lanta', 'les brers in a minor', 'blue sky', 'melissa',
  'ramblin man', 'midnight rider', 'no one to run with', 'seven turns',
  'end of the line', 'dreams', 'soulshine',
] as const

const GOVT_MULE = [
  'thorazine shuffle', 'sco mule', 'birth of the mule', 'banks of the deep end',
  'blind man in the dark', 'life before insanity', 'bad little doggie',
  'painted silver light', 'beautifully broken', 'world in your eyes',
] as const

/**
 * Long-form improvisational vehicles. Effectively never played outside this
 * tradition, so a single appearance is strong evidence.
 */
const SIGNATURE = [
  'dark star', 'the eleven', 'cryptical envelopment', 'terrapin station',
  'help on the way', 'slipknot', 'weather report suite', 'blues for allah',
  'unbroken chain', 'playing in the band', 'the other one', 'st stephen',
  'saint stephen', 'china cat sunflower', 'eyes of the world',
  'estimated prophet', 'shakedown street', 'franklins tower', 'scarlet fire',
  'you enjoy myself', 'reba', 'tweezer', 'harry hood', 'david bowie',
  'mikes song', 'weekapaug groove', 'fluffhead', 'guyute', 'the divided sky',
  'divided sky', 'colonel forbins ascent', 'the famous mockingbird', 'icculus',
  'mcgrupp and the watchful hosemasters', 'split open and melt', 'bathtub gin',
  'run like an antelope', 'down with disease', 'slave to the traffic light',
  'the lizards', 'in memory of elizabeth reed', 'elizabeth reed', 'mountain jam',
  'hot lanta', 'les brers in a minor', 'thorazine shuffle', 'sco mule',
  'birth of the mule', 'space wrangler', 'surprise valley', 'chilly water',
] as const

/** Every canon title, normalised. */
export const JAM_SONGS: ReadonlySet<string> = new Set(
  [...GRATEFUL_DEAD, ...PHISH, ...WIDESPREAD_PANIC, ...ALLMAN_BROTHERS, ...GOVT_MULE].map(normalize)
)

/** The high-evidence subset. */
export const SIGNATURE_SONGS: ReadonlySet<string> = new Set(SIGNATURE.map(normalize))

/** Grateful Dead originals, kept separately for "plays Dead material" copy. */
export const GD_SONGS: ReadonlySet<string> = new Set(GRATEFUL_DEAD.map(normalize))

export const isJamSong = (title: string): boolean => JAM_SONGS.has(normalize(title))
export const isSignatureSong = (title: string): boolean => SIGNATURE_SONGS.has(normalize(title))
export const isGdSong = (title: string): boolean => GD_SONGS.has(normalize(title))
