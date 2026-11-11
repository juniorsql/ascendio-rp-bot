import { UserError } from './input.js';

export function youtubeUrl(value: string): string {
  if (!value.trim()) return '';
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { throw new UserError('Informe o link HTTPS de um vídeo do YouTube.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new UserError('Use um link HTTPS do YouTube.');
  const host = url.hostname;
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host === 'youtu.be') {
    if (parts.length === 1) id = parts[0];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0]!)) id = parts[1];
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new UserError('Envie o link de um vídeo do YouTube, incluindo links youtu.be, Shorts ou transmissões.');
  const result = new URL('https://www.youtube.com/watch');
  result.searchParams.set('v', id);
  const start = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (start && /^(?:\d+h)?(?:\d+m)?\d+s?$/.test(start)) result.searchParams.set('t', start);
  return result.href;
}

export function youtubeThumbnail(value: string): string {
  const url = new URL(youtubeUrl(value));
  return `https://i.ytimg.com/vi/${url.searchParams.get('v')}/hqdefault.jpg`;
}
