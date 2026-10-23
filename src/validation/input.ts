import { isIP } from 'node:net';
import type { APIEmbed } from 'discord.js';
export class UserError extends Error {}
export function text(value: string, max: number, label = 'Texto', min = 1): string {
  const s = value.trim();
  if (s.length < min || s.length > max) throw new UserError(`${label}: use entre ${min} e ${max} caracteres.`);
  return s;
}
export function snowflake(value: string, label = 'ID'): string {
  if (!/^[0-9]{17,20}$/.test(value)) throw new UserError(`${label} deve ser um ID válido do Discord.`);
  return value;
}
export function imageUrl(value: string): string {
  if (!value.trim()) return '';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new UserError('Imagem: informe uma URL HTTPS válida.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(host) || !host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || url.href.length > 2048) {
    throw new UserError('Imagem: use HTTPS em um domínio público, sem credenciais, IP ou porta personalizada.');
  }
  // Não fazemos requisições ao endereço: o cliente do Discord renderiza a imagem.
  return url.href;
}
export function color(value: string): number {
  if (!/^#?[0-9a-f]{6}$/i.test(value)) throw new UserError('Cor: use um hexadecimal de seis dígitos, como #B49A61.');
  return parseInt(value.replace('#', ''), 16);
}
export function safeText(value: string): string {
  return value.replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@([!&]?)(\d+)>/g, '<@\u200b$1$2>');
}
export function fields(value: string): NonNullable<APIEmbed['fields']> {
  if (!value.trim()) return [];
  const lines = value.trim().split('\n');
  if (lines.length > 10) throw new UserError('Use no máximo 10 campos adicionais.');
  return lines.map(line => {
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 2 || parts.length > 3 || (parts[2] && !['sim', 'nao', 'não'].includes(parts[2]))) throw new UserError('Campos: use Nome | Valor | sim (uma linha por campo).');
    return { name: safeText(text(parts[0]!, 256, 'Nome do campo')), value: safeText(text(parts[1]!, 1024, 'Valor do campo')), inline: parts[2] === 'sim' };
  });
}
export function validateEmbeds(embeds: APIEmbed[]): void {
  if (!embeds.length || embeds.length > 10) throw new UserError('Uma mensagem deve ter de 1 a 10 embeds.');
  let sum = 0;
  for (const e of embeds) {
    for (const [s, max] of [[e.title, 256], [e.description, 4096], [e.footer?.text, 2048], [e.author?.name, 256]] as const) {
      if (s !== undefined && (s.length < 1 || s.length > max)) throw new UserError(`Um texto do embed ultrapassa o limite de ${max} caracteres.`);
      sum += s?.length ?? 0;
    }
    if ((e.fields?.length ?? 0) > 25) throw new UserError('Limite de 25 campos por embed.');
    for (const f of e.fields ?? []) { text(f.name, 256); text(f.value, 1024); sum += f.name.length + f.value.length; }
    if (e.image?.url) imageUrl(e.image.url);
    if (e.thumbnail?.url) imageUrl(e.thumbnail.url);
  }
  if (sum > 6000) throw new UserError(`Os embeds somam ${sum} caracteres. O limite por mensagem é 6000.`);
}
