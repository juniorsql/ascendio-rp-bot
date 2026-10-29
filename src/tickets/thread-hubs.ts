import { ChannelType, PermissionFlagsBits as P, PermissionsBitField, type Guild, type GuildMember, type OverwriteResolvable, type Role, type TextChannel, type ThreadChannel } from 'discord.js';
import { UserError } from '../validation/input.js';
import { departments, ticketLabels, type Department, type Ticket, type TicketConfig } from './store.js';

const view = [P.ViewChannel, P.ReadMessageHistory, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles, P.AddReactions];
const restricted = [P.SendMessages, P.CreatePrivateThreads, P.CreatePublicThreads, P.ManageThreads, P.MentionEveryone, P.ManageChannels, P.ManageRoles, P.ManageWebhooks];
export function hubTopic(d: Department): string { return `ascendio-ticket-hub:v1:${d}`; }
export function threadName(t: Ticket): string { return `${t.department}-${t.id}`; }
export function accessRoleName(d: Department): string { return `Acesso a tickets • ${ticketLabels[d].label}`; }
export function hubOverwrites(guildId: string, botId: string, roleIds: string[], accessRoleId: string): OverwriteResolvable[] {
  if (roleIds.includes(guildId) || roleIds.includes(botId) || roleIds.includes(accessRoleId) || [guildId, botId].includes(accessRoleId)) throw new UserError('Cargos da equipe inválidos.');
  return [
    { id: guildId, type: 0, deny: [P.ViewChannel, ...restricted] },
    { id: accessRoleId, type: 0, allow: view, deny: restricted },
    ...[...new Set(roleIds)].map(id => ({ id, type: 0 as const, allow: [...view, P.ManageThreads], deny: restricted.filter(p => p !== P.ManageThreads) })),
    { id: botId, type: 1, allow: [...view, P.SendMessages, P.CreatePrivateThreads, P.ManageThreads, P.ManageChannels, P.ManageRoles], deny: [P.CreatePublicThreads, P.MentionEveryone] },
  ];
}
export function assertHub(hub: TextChannel, guildId: string, botId: string, d: Department, route: TicketConfig['routes'][Department]): void {
  if (hub.topic !== hubTopic(d) || hub.parentId !== route.categoryId) throw new UserError('A central de tópicos foi alterada. Peça à administração para executar /ticket topicos.');
  if (!route.accessRoleId) throw new UserError('O setor precisa de um cargo de acesso. Execute /ticket topicos.');
  const expected = hubOverwrites(guildId, botId, route.roleIds, route.accessRoleId);
  if (hub.permissionOverwrites.cache.size !== expected.length || expected.some(o => {
    const actual = hub.permissionOverwrites.cache.get(String(o.id));
    return !actual || actual.type !== o.type || actual.allow.bitfield !== new PermissionsBitField(o.allow).bitfield || actual.deny.bitfield !== new PermissionsBitField(o.deny).bitfield;
  })) throw new UserError('As permissões da central foram alteradas. A abertura foi bloqueada; use /ticket topicos para restaurá-las.');
}
export async function accessRole(guild: Guild, roleId: string, d: Department): Promise<Role> {
  const role = await guild.roles.fetch(roleId, { force: true });
  const me = await guild.members.fetchMe({ force: true });
  if (!role || role.id === guild.id || role.managed || role.name !== accessRoleName(d) || role.permissions.bitfield !== 0n || role.hoist || role.mentionable || me.roles.highest.comparePositionTo(role) <= 0) throw new UserError('Cargo de acesso aos tickets inválido ou fora da hierarquia do bot. Confira o setor antes de continuar.');
  return role;
}
export async function grantHubAccess(member: GuildMember, route: TicketConfig['routes'][Department], d: Department): Promise<void> {
  if (!route.accessRoleId) throw new UserError('O cargo de acesso do setor ainda não foi configurado.');
  await accessRole(member.guild, route.accessRoleId, d);
  if (!member.roles.cache.has(route.accessRoleId)) await member.roles.add(route.accessRoleId, 'Acesso ao setor do próprio atendimento e histórico');
}
async function preserveParticipants(hub: TextChannel, roleId: string, d: Department, botId: string): Promise<void> {
  const active = await hub.threads.fetchActive(false);
  const granted = new Set<string>();
  const preserve = async (thread: ThreadChannel) => {
    // Apenas tópicos próprios; não transformar convites de outras aplicações em acesso.
    if (thread.type !== ChannelType.PrivateThread || thread.ownerId !== botId || !new RegExp(`^${d}-[a-f0-9]{20}$`).test(thread.name)) return;
    let after: string | undefined;
    for (;;) {
      const members = await thread.members.fetch({ withMember: true, cache: false, limit: 100, ...(after ? { after } : {}) });
      for (const entry of members.values()) {
        if (entry.id === botId || granted.has(entry.id)) continue;
        let member: GuildMember;
        try { member = await hub.guild.members.fetch({ user: entry.id, force: true }); }
        catch (e) { if ((e as { code?: number }).code === 10007) continue; throw e; }
        if (!member.user.bot && !member.permissions.has(P.Administrator)) await member.roles.add(roleId, 'Preservar acesso ao histórico do ticket após ocultar centrais');
        granted.add(entry.id);
      }
      const last = members.last()?.id;
      if (members.size < 100 || !last || last === after) break;
      after = last;
    }
  };
  for (const thread of active.threads.values()) await preserve(thread);
  let before: Date | undefined;
  for (;;) {
    const page = await hub.threads.fetchArchived({ type: 'private', fetchAll: true, limit: 100, ...(before ? { before } : {}) }, false);
    for (const thread of page.threads.values()) await preserve(thread);
    const oldest = page.threads.last()?.archiveTimestamp;
    if (!page.hasMore || !oldest || (before && oldest >= before.getTime())) break;
    before = new Date(oldest);
  }
}
export async function ensureHubs(guild: Guild, config: TicketConfig, botId: string): Promise<Record<Department, { parentChannelId: string; accessRoleId: string }>> {
  const channels = await guild.channels.fetch();
  const roles = await guild.roles.fetch();
  const result = {} as Record<Department, { parentChannelId: string; accessRoleId: string }>;
  for (const d of departments) {
    const route = config.routes[d];
    let hub = route.parentChannelId ? channels.get(route.parentChannelId) : channels.find(ch => ch?.type === ChannelType.GuildText && ch.topic === hubTopic(d));
    if (hub && (hub.type !== ChannelType.GuildText || hub.topic !== hubTopic(d))) throw new UserError('O canal configurado não é uma central de tickets deste bot.');
    const matches = roles.filter(r => r.name === accessRoleName(d));
    if (!route.accessRoleId && matches.size > 1) throw new UserError('Há cargos de acesso duplicados. Confira os cargos do setor.');
    const role = route.accessRoleId ? await accessRole(guild, route.accessRoleId, d) : matches.first() ?? await guild.roles.create({ name: accessRoleName(d), permissions: [], hoist: false, mentionable: false, reason: 'Acesso individual ao setor de tickets, sem permissões administrativas' });
    await accessRole(guild, role.id, d);
    // Migração única: concede acesso aos participantes existentes antes de esconder a central.
    if (hub && !route.accessRoleId) await preserveParticipants(hub, role.id, d, botId);
    const permissionOverwrites = hubOverwrites(guild.id, botId, route.roleIds, role.id);
    if (!hub) hub = await guild.channels.create({ name: `atendimentos-${d}`, type: ChannelType.GuildText, parent: route.categoryId, topic: hubTopic(d), permissionOverwrites, reason: 'Central de tópicos privados por departamento' });
    else await hub.edit({ parent: route.categoryId, lockPermissions: false, permissionOverwrites, reason: 'Atualizar acesso da equipe à central de tópicos' });
    result[d] = { parentChannelId: hub.id, accessRoleId: role.id };
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
