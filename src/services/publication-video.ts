import type { Attachment } from 'discord.js';
import { UserError } from '../validation/input.js';

export const videoMaxBytes = 15_000_000;
export const videoFilename = 'ascendio-video.mp4';
export type PublicationVideo = Pick<Attachment, 'id' | 'url' | 'size'>;

export function publicationVideo(file: Attachment): PublicationVideo {
  const url = new URL(file.url);
  if (url.origin !== 'https://cdn.discordapp.com' || !/^\/(?:ephemeral-)?attachments\/\d+\/\d+\//.test(url.pathname)) {
    throw new UserError('Envie o MP4 pelo campo de arquivo do Discord.');
  }
  if (!/\.mp4$/i.test(file.name) || (file.contentType && file.contentType !== 'video/mp4')) {
    throw new UserError('Escolha um vídeo no formato MP4.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 12 || file.size > videoMaxBytes) {
    throw new UserError('Envie um vídeo MP4 de até 15 MB.');
  }
  return { id: file.id, url: file.url, size: file.size };
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
    if (data.toString('ascii', 4, 8) !== 'ftyp') throw new UserError('O arquivo não parece ser um MP4 válido. Exporte o vídeo como MP4 e tente novamente.');
    return data;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Não consegui baixar o vídeo para publicar. Anexe o arquivo novamente e tente de novo.');
  }
}
