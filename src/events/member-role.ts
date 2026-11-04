import { PermissionFlagsBits, type Guild, type GuildMember, type PartialGuildMember } from 'discord.js';
import { errorCode, log } from '../logs/logger.js';
import { UserError } from '../validation/input.js';
import type { Context } from '../commands/handler.js';

export async function joinRole(guild: Guild, roleId: string) {
  const role = await guild.roles.fetch(roleId, { force: true });
  if (!role || role.id === guild.id || role.managed) throw new UserError('O cargo de entrada precisa ser um cargo próprio do servidor.');
  const me = await guild.members.fetchMe({ force: true });
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new UserError('O bot precisa de Gerenciar cargos para atribuir o cargo de entrada.');
  if (me.roles.highest.comparePositionTo(role) <= 0) throw new UserError('O maior cargo do bot precisa estar acima do cargo de entrada.');
  return role;
}
const assigning = new Set<string>();
const recovering = new WeakSet<Context['client']>();
export async function assignJoinRole(member: GuildMember, ctx: Context): Promise<boolean> {
  const roleId = ctx.env.joinRoleId;
  if (!roleId || member.guild.id !== ctx.env.guildId || member.user.bot || member.roles.cache.has(roleId)) return false;
  const key = `${member.guild.id}:${member.id}:${roleId}`;
  if (assigning.has(key)) return false;
  assigning.add(key);
  try {
    const role = await joinRole(member.guild, roleId);
    // PUT de um cargo: preserva todos os cargos que o membro já possui.
    await member.roles.add(role.id, 'Cargo de entrada automático do Ascendio RP');
    log('join_role_assigned', { userId: member.id, guildId: member.guild.id, roleId });
    return true;
  } catch (error) {
    log('join_role_failed', { userId: member.id, guildId: member.guild.id, roleId, code: errorCode(error) }, 'error');
    return false;
  } finally { assigning.delete(key); }
}

export async function onMemberScreened(before: GuildMember | PartialGuildMember, member: GuildMember, ctx: Context): Promise<void> {
  // Ignora atualizações comuns; cache parcial só permite recuperar recém-chegado ainda sem cargos.
  if (member.pending === false && (before.pending === true || (before.pending !== false && recoverable(member, ctx, Date.now())))) await assignJoinRole(member, ctx);
}

function recoverable(member: GuildMember, ctx: Context, now: number): boolean {
  const joined = member.joinedTimestamp;
  return member.guild.id === ctx.env.guildId && !member.user.bot && joined !== null && joined <= now && now - joined <= 7 * 86400_000
    && !member.roles.cache.has(ctx.env.joinRoleId) && !member.roles.cache.some(role => role.id !== member.guild.id);
}

export async function recoverJoinRoles(ctx: Context, now = Date.now()) {
  const result = { checked: 0, assigned: 0, pendingAtScan: 0, truncated: false };
  if (!ctx.env.joinRoleId || recovering.has(ctx.client)) return result;
  recovering.add(ctx.client);
  try {
    const guild = await ctx.client.guilds.fetch(ctx.env.guildId);
    await joinRole(guild, ctx.env.joinRoleId);
    let after: string | undefined;
    // REST paginada, sem carregar todos os membros no cache de 256 MB da hospedagem.
    for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
      const page = await guild.members.list({ limit: 200, after, cache: false });
      for (const member of page.values()) {
        result.checked++;
        if (!recoverable(member, ctx, now)) continue;
        if (member.pending === true) result.pendingAtScan++;
        // Consulta novamente antes do PUT: alguém pode ter aprovado o membro durante a varredura.
        const fresh = await guild.members.fetch({ user: member.id, force: true, cache: false });
        if (!recoverable(fresh, ctx, now)) continue;
        if (await assignJoinRole(fresh, ctx)) result.assigned++;
        if (result.assigned >= 25) { result.truncated = true; break; }
      }
      if (result.truncated || page.size < 200) break;
      after = page.last()!.id;
      if (pageNumber === 19) result.truncated = true;
    }
    log('join_role_recovery', { guildId: ctx.env.guildId, roleId: ctx.env.joinRoleId, action: `checked=${result.checked};assigned=${result.assigned};pending=${result.pendingAtScan};truncated=${result.truncated}` });
    return result;
  } finally { recovering.delete(ctx.client); }
}
