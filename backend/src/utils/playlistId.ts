// Playlist-ID parsing/validation for requests. This is input validation, not a
// learning calculation — the calculation engine lives in the frontend.

export const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
export const MAX_ENTRIES = 1000;

export function parsePlaylistId(input: string): string {
  if (typeof input !== 'string') throw httpError('Playlist input must be text.', 400);
  const trimmed = input.trim();
  if (!trimmed) throw httpError('Enter a YouTube playlist URL or playlist ID.', 400);
  if (PLAYLIST_ID_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
      const list = url.searchParams.get('list');
      if (list && PLAYLIST_ID_RE.test(list)) return list;
    }
  } catch {
    // fall through
  }
  const m = /[?&]list=([A-Za-z0-9_-]{10,64})/.exec(trimmed);
  if (m) return m[1];
  throw httpError('Invalid playlist. Paste a youtube.com/playlist?list=ID link or the playlist ID itself.', 400);
}

export function httpError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}
