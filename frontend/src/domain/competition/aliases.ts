// Fictional gamer-alias generator for the simulated Arena.
// Curated themed parts compose into coherent PascalCase aliases
// (NeonRonin, QuantumRaider, PixelValkyrie…). Deterministic from the provided
// PRNG; uniqueness enforced per cohort — never bare firstName+lastName lists,
// never bare incrementing numbers, nothing offensive.

interface Theme {
  first: string[];
  second: string[];
}

const THEMES: Theme[] = [
  { // cyberpunk
    first: ['Neon', 'Chrome', 'Glitch', 'Cipher', 'Pixel', 'Synth', 'Volt', 'Holo', 'Zero', 'Nyx'],
    second: ['Ronin', 'Phantom', 'Valkyrie', 'Specter', 'Drifter', 'Mirage', 'Circuit', 'Ghost', 'Daemon', 'Static'],
  },
  { // tactical
    first: ['Iron', 'Apache', 'Turbo', 'Strike', 'Falcon', 'Raptor', 'Sable', 'Onyx', 'Flint', 'Cobalt'],
    second: ['Comet', 'Sentinel', 'Vanguard', 'Helix', 'Talons', 'Bastion', 'Recon', 'Havoc', 'Lance', 'Rampart'],
  },
  { // space
    first: ['Nova', 'Astro', 'Lunar', 'Solar', 'Void', 'Stellar', 'Comet', 'Orbit', 'Nebula', 'Quasar'],
    second: ['Ranger', 'Voyager', 'Drifter', 'Warden', 'Nomad', 'Seeker', 'Walker', 'Pilot', 'Sentry', 'Echo'],
  },
  { // mythic
    first: ['Fenrir', 'Kraken', 'Griffin', 'Hydra', 'Phoenix', 'Titan', 'Valkyr', 'Golem', 'Sphinx', 'Djinn'],
    second: ['Bane', 'Song', 'Oath', 'Brand', 'Howl', 'Crest', 'Fang', 'Ward', 'Myth', 'Reign'],
  },
  { // stealth
    first: ['Shadow', 'Silent', 'Night', 'Eclipse', 'Mist', 'Dusk', 'Wraith', 'Shade', 'Fog', 'Umbra'],
    second: ['Blade', 'Falcon', 'Step', 'Whisper', 'Veil', 'Prowl', 'Thorn', 'Mantle', 'Lurk', 'Shroud'],
  },
  { // robotics
    first: ['Bolt', 'Gear', 'Servo', 'Titan', 'Cog', 'Axion', 'Dynamo', 'Ferric', 'Hex', 'Torque'],
    second: ['Frame', 'Works', 'Mind', 'Forge', 'Unit', 'Core', 'Mesh', 'Drive', 'Smith', 'Logic'],
  },
  { // speed
    first: ['Turbo', 'Blitz', 'Dash', 'Sonic', 'Rapid', 'Swift', 'Jet', 'Flash', 'Zoom', 'Vortex'],
    second: ['Surge', 'Line', 'Rush', 'Current', 'Trail', 'Burst', 'Stream', 'Flight', 'Pace', 'Streak'],
  },
  { // intel & code
    first: ['Quantum', 'Binary', 'Logic', 'Cipher', 'Kernel', 'Vector', 'Lambda', 'Pixel', 'Syntax', 'Tensor'],
    second: ['Raider', 'Sage', 'Craft', 'Lock', 'Smith', 'Scope', 'Parse', 'Proof', 'Script', 'Theorem'],
  },
];

const FALLBACK_EPITHETS = ['Prime', 'Zero', 'X', 'Nova', 'Oath', 'Hex', 'Flux', 'Zen'];

/**
 * Draw one alias. Retries across themes for a fresh combination; the final
 * fallback hyphenates a second core (still no bare numbers).
 */
export function generateAlias(rnd: () => number, used: Set<string>): string {
  for (let attempt = 0; attempt < 60; attempt++) {
    const theme = THEMES[Math.floor(rnd() * THEMES.length)];
    const a = theme.first[Math.floor(rnd() * theme.first.length)];
    const b = theme.second[Math.floor(rnd() * theme.second.length)];
    const name = rnd() < 0.55 ? `${a}${b}` : `${b}${a}`;
    if (!used.has(name) && name.length >= 6 && name.length <= 20) {
      used.add(name);
      return name;
    }
  }
  // Collision-safe fallback: distinct hyphenated pairing (documented, rare)
  for (let attempt = 0; attempt < 60; attempt++) {
    const t1 = THEMES[Math.floor(rnd() * THEMES.length)];
    const t2 = THEMES[Math.floor(rnd() * THEMES.length)];
    const name = `${t1.first[Math.floor(rnd() * t1.first.length)]}${t2.second[Math.floor(rnd() * t2.second.length)]}-${FALLBACK_EPITHETS[Math.floor(rnd() * FALLBACK_EPITHETS.length)]}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Practically unreachable (8000+ combos); guarantees termination.
  let n = used.size;
  let name = `RogueVector-${FALLBACK_EPITHETS[n % FALLBACK_EPITHETS.length]}${Math.floor(n / FALLBACK_EPITHETS.length) + 2}`;
  while (used.has(name)) {
    n += 1;
    name = `RogueVector-${FALLBACK_EPITHETS[n % FALLBACK_EPITHETS.length]}${Math.floor(n / FALLBACK_EPITHETS.length) + 2}`;
  }
  used.add(name);
  return name;
}

export function initialsOf(alias: string): string {
  const parts = alias.split(/(?=[A-Z])|[-_]/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}
