import { ChannelType, PermissionFlagsBits as P, PermissionsBitField, type Guild, type OverwriteResolvable, type TextChannel, type ThreadChannel } from 'discord.js';
import { UserError } from '../validation/input.js';
import { departments, type Department, type Ticket, type TicketConfig } from './store.js';

const view = [P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles, P.AddReactions];
const restricted = [P.SendMessages, P.CreatePrivateThreads, P.CreatePublicThreads, P.ManageThreads, P.MentionEveryone, P.ManageChannels, P.ManageRoles, P.ManageWebhooks];
export function hubTopic(d: Department): string { return `ascendio-ticket-hub:v1:${d}`; }
export function threadName(t: Ticket): string { return `${t.department}-${t.id}`; }
export function hubOverwrites(guildId: string, botId: string, roleIds: string[]): OverwriteResolvable[] {
  if (roleIds.includes(guildId) || roleIds.includes(botId)) throw new UserError('Cargos da equipe inválidos.');
  return [
    { id: guildId, type: 0, allow: view, deny: restricted },
    ...[...new Set(roleIds)].map(id => ({ id, type: 0 as const, allow: [...view, P.ManageThreads], deny: restricted.filter(p => p !== P.ManageThreads) })),
    { id: botId, type: 1, allow: [...view, P.SendMessages, P.CreatePrivateThreads, P.ManageThreads, P.ManageChannels, P.ManageRoles], deny: [P.CreatePublicThreads, P.MentionEveryone] },
  ];
}
export function assertHub(hub: TextChannel, guildId: string, botId: string, d: Department, route: TicketConfig['routes'][Department]): void {
  if (hub.topic !== hubTopic(d) || hub.parentId !== route.categoryId) throw new UserError('A central de tópicos foi alterada. Peça à administração para executar /ticket topicos.');
  const expected = hubOverwrites(guildId, botId, route.roleIds);
  if (hub.permissionOverwrites.cache.size !== expected.length || expected.some(o => {
    const actual = hub.permissionOverwrites.cache.get(String(o.id));
    return !actual || actual.type !== o.type || actual.allow.bitfield !== new PermissionsBitField(o.allow).bitfield || actual.deny.bitfield !== new PermissionsBitField(o.deny).bitfield;
  })) throw new UserError('As permissões da central foram alteradas. A abertura foi bloqueada; use /ticket topicos para restaurá-las.');
}
export async function ensureHubs(guild: Guild, config: TicketConfig, botId: string): Promise<Record<Department, string>> {
  const channels = await guild.channels.fetch();
  const result = {} as Record<Department, string>;
  for (const d of departments) {
    const route = config.routes[d];
    let hub = route.parentChannelId ? channels.get(route.parentChannelId) : channels.find(ch => ch?.type === ChannelType.GuildText && ch.topic === hubTopic(d));
    if (hub && (hub.type !== ChannelType.GuildText || hub.topic !== hubTopic(d))) throw new UserError('O canal configurado não é uma central de tickets deste bot.');
    const permissionOverwrites = hubOverwrites(guild.id, botId, route.roleIds);
    if (!hub) hub = await guild.channels.create({ name: `atendimentos-${d}`, type: ChannelType.GuildText, parent: route.categoryId, topic: hubTopic(d), permissionOverwrites, reason: 'Central de tópicos privados por departamento' });
    else await hub.edit({ parent: route.categoryId, lockPermissions: false, permissionOverwrites, reason: 'Atualizar acesso da equipe à central de tópicos' });
    result[d] = hub.id;
  }
  return result;
}
export async function findThread(parent: TextChannel, ticket: Ticket): Promise<ThreadChannel | undefined> {
  const active = await parent.threads.fetchActive(false);
  const existing = active.threads.find(t => t.type === ChannelType.PrivateThread && t.name === threadName(ticket));
  if (existing) return existing;
  // Uma abertura interrompida pode ter sido arquivada por inatividade. Não criamos outra.
  let before: Date | undefined;
  for (;;) {
    const page = await parent.threads.fetchArchived({ type: 'private', fetchAll: true, limit: 100, ...(before ? { before } : {}) }, false);
    const found = page.threads.find(t => t.type === ChannelType.PrivateThread && t.name === threadName(ticket));
    if (found) return found;
    const oldest = page.threads.last()?.archiveTimestamp;
    if (!page.hasMore || !oldest || oldest < ticket.createdAt || (before && oldest >= before.getTime())) return;
    before = new Date(oldest);
  }
}
