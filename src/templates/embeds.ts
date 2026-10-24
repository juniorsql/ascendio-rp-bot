import type { APIEmbed } from 'discord.js';
import { palette, type Config, type Kind } from '../config/defaults.js';
import { safeText, validateEmbeds } from '../validation/input.js';
export interface Post { kind: Kind; title: string; description: string; image: string; thumbnail: string; fields: NonNullable<APIEmbed['fields']>; color?: number }
export function postEmbed(post: Post, config: Config): APIEmbed[] {
  const t = config.templates[post.kind];
  const image = post.image || t.image;
  const thumbnail = post.thumbnail || t.thumbnail || config.logo;
  const embed: APIEmbed = {
    title: safeText(post.title), description: safeText(post.description), color: post.color ?? t.color,
    fields: post.fields.map(f => ({ ...f, name: safeText(f.name), value: safeText(f.value) })),
    footer: { text: safeText(t.footer || config.footer) }, timestamp: new Date().toISOString(),
    ...(image ? { image: { url: image } } : {}), ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
  };
  validateEmbeds([embed]); return [embed];
}
export function rulesEmbeds(config: Config): APIEmbed[] {
  const embeds = config.rules.map((r, i): APIEmbed => ({
    title: safeText(`${String(i + 1).padStart(2, '0')} · ${r.title}`),
    description: safeText(`${r.official ? '' : '**DEMONSTRAÇÃO — NÃO OFICIAL**\n\n'}${r.content}`),
    color: config.templates.regras.color,
    footer: { text: safeText(`${config.name} • ${r.official ? 'Regulamento' : 'Conteúdo demonstrativo'}`) },
  }));
  validateEmbeds(embeds); return embeds;
}
export function welcomeEmbed(config: Config, memberId: string): APIEmbed[] {
  const description = safeText(config.welcomeText).replaceAll('{membro}', `<@${memberId}>`).replaceAll('{servidor}', safeText(config.name))
    .replaceAll('{regras}', config.rulesChannelId ? `<#${config.rulesChannelId}>` : 'as regras do servidor');
  const embeds: APIEmbed[] = [{ title: safeText(config.welcomeTitle), description, color: palette.dourado,
    footer: { text: safeText(config.footer) }, ...(config.logo ? { thumbnail: { url: config.logo } } : {}) }];
  validateEmbeds(embeds); return embeds;
}
