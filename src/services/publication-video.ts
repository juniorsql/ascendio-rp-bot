import type { Attachment } from 'discord.js';
import { UserError } from '../validation/input.js';

export const videoMaxBytes = 15_000_000;
export type PublicationVideo = Pick<Attachment, 'id' | 'url' | 'size'> & { format: 'mp4' | 'mov' };

export function publicationVideo(file: Attachment): PublicationVideo {
  const url = new URL(file.url);
  if (url.origin !== 'https://cdn.discordapp.com' || !/^\/(?:ephemeral-)?attachments\/\d+\/\d+\//.test(url.pathname)) {
    throw new UserError('Envie o vídeo pelo campo de arquivo do Discord.');
  }
  const format = file.name?.match(/\.(mp4|mov)$/i)?.[1]?.toLowerCase();
  if (format !== 'mp4' && format !== 'mov') {
    throw new UserError('Escolha um vídeo no formato MP4 ou MOV.');
  }
  const acceptedTypes = format === 'mov' ? ['video/quicktime', 'video/mp4', 'application/octet-stream'] : ['video/mp4'];
  if (file.contentType && !acceptedTypes.includes(file.contentType)) {
    throw new UserError('Escolha um vídeo no formato MP4 ou MOV.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 12 || file.size > videoMaxBytes) {
    throw new UserError('Envie um vídeo MP4 ou MOV de até 15 MB.');
  }
  return { id: file.id, url: file.url, size: file.size, format };
}

function hasQuickTimeMovie(data: Buffer): boolean {
  let hasMovie = false;
  let hasMedia = false;
  for (let offset = 0; offset < data.length;) {
    const remaining = data.length - offset;
    if (remaining < 8) return false;
    let size = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      header = 16;
      if (remaining < header) return false;
      const extendedSize = data.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(remaining)) return false;
      size = Number(extendedSize);
    } else if (size === 0) {
      size = remaining;
    }
    if (size < header || size > remaining) return false;
    if (type === 'moov' && size > header) hasMovie = true;
    if (type === 'mdat' && size > header) hasMedia = true;
    offset += size;
  }
  return hasMovie && hasMedia;
}

export async function downloadPublicationVideo(video: PublicationVideo): Promise<Buffer> {
  try {
    const response = await fetch(video.url, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error('Video download unavailable');
    const data = Buffer.alloc(video.size);
    let offset = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (offset + value.length > data.length) throw new Error('Video exceeds upload size');
        data.set(value, offset);
        offset += value.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (offset !== data.length) throw new Error('Incomplete video');
    const valid = video.format === 'mov' ? hasQuickTimeMovie(data) : data.toString('ascii', 4, 8) === 'ftyp';
    if (!valid) throw new UserError(`O arquivo não parece ser um ${video.format.toUpperCase()} válido. Exporte o vídeo novamente e tente de novo.`);
    return data;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Não consegui baixar o vídeo para publicar. Anexe o arquivo novamente e tente de novo.');
  }
}
