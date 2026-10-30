import { ChannelType, PermissionFlagsBits as P, PermissionsBitField, type Guild, type OverwriteResolvable, type TextChannel } from 'discord.js';
import { UserError } from '../validation/input.js';
import { departments, ticketLabels, type Department, type Ticket, type TicketConfig } from './store.js';

const staffView = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.EmbedLinks, P.AttachFiles];
export function notificationTopic(d: Department): string { return `ascendio-ticket-alerts:v1:${d}`; }
export function notificationOverwrites(guildId: string, botId: string, roleIds: string[]): OverwriteResolvable[] {
  if (roleIds.includes(guildId) || roleIds.includes(botId) || !roleIds.length) throw new UserError('Equipe dos avisos inválida.');
  return [
    { id: guildId, type: 0, deny: [P.ViewChannel, P.CreatePrivateThreads, P.CreatePublicThreads, P.ManageWebhooks, P.MentionEveryone] },
    ...[...new Set(roleIds)].map(id => ({ id, type: 0 as const, allow: staffView, deny: [P.MentionEveryone] })),
    { id: botId, type: 1, allow: [...staffView, P.ManageChannels, P.ManageRoles, P.MentionEveryone] },
  ];
}
export function assertNotificationChannel(channel: TextChannel, guildId: string, botId: string, d: Department, route: TicketConfig['routes'][Department]): void {
  const expected = notificationOverwrites(guildId, botId, route.roleIds);
  if (channel.guildId !== guildId || channel.topic !== notificationTopic(d) || channel.parentId !== route.categoryId || channel.permissionOverwrites.cache.size !== expected.length || expected.some(o => {
    const actual = channel.permissionOverwrites.cache.get(String(o.id));
    return !actual || actual.type !== o.type || actual.allow.bitfield !== new PermissionsBitField(o.allow).bitfield || actual.deny.bitfield !== new PermissionsBitField(o.deny).bitfield;
  })) throw new UserError('O canal de avisos precisa estar restrito à equipe do setor. Use /ticket topicos para restaurar os acessos.');
}
export async function ensureNotificationChannels(guild: Guild, config: TicketConfig, botId: string): Promise<Record<Department, string>> {
  const channels = await guild.channels.fetch();
  const result = {} as Record<Department, string>;
  for (const d of departments) {
    const route = config.routes[d];
    let ch = route.notificationChannelId ? channels.get(route.notificationChannelId) : channels.find(c => c?.type === ChannelType.GuildText && c.topic === notificationTopic(d));
    if (ch && (ch.type !== ChannelType.GuildText || ch.topic !== notificationTopic(d))) throw new UserError('Destino de avisos não pertence à central do bot.');
    const permissionOverwrites = notificationOverwrites(guild.id, botId, route.roleIds);
    if (!ch) ch = await guild.channels.create({ name: `avisos-${d}`, type: ChannelType.GuildText, parent: route.categoryId, topic: notificationTopic(d), permissionOverwrites, reason: 'Avisos privados de novos tickets à equipe responsável' });
    else await ch.edit({ parent: route.categoryId, lockPermissions: false, permissionOverwrites, reason: 'Atualizar equipe dos avisos de tickets' });
    result[d] = ch.id;
  }
  return result;
}
export function openingNotice(t: Ticket, guildId: string, roleIds: string[], userIds: string[] = []) {
  const roles = [...new Set(roleIds)];
  const users = [...new Set(userIds)];
  return {
    content: `${[...roles.map(id => `<@&${id}>`), ...users.map(id => `<@${id}>`)].join(' ')}\n**Novo atendimento • ${ticketLabels[t.department].label}**\nSolicitante: <@${t.ownerId}>\nAbrir atendimento: https://discord.com/channels/${guildId}/${t.channelId}\nTicket: ${t.id}`,
    allowedMentions: { parse: [] as never[], roles, users, repliedUser: false },
    nonce: `open${t.id}`, enforceNonce: true,
  };
}
