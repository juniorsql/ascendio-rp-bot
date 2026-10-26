import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
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
export async function assignJoinRole(member: GuildMember, ctx: Context): Promise<void> {
  const roleId = ctx.env.joinRoleId;
  if (!roleId || member.guild.id !== ctx.env.guildId || member.user.bot || member.roles.cache.has(roleId)) return;
  try {
    const role = await joinRole(member.guild, roleId);
    // PUT de um cargo: preserva todos os cargos que o membro já possui.
    await member.roles.add(role.id, 'Cargo de entrada automático do Ascendio RP');
    log('join_role_assigned', { userId: member.id, guildId: member.guild.id, roleId });
  } catch (error) { log('join_role_failed', { userId: member.id, guildId: member.guild.id, roleId, code: errorCode(error) }, 'error'); }
}
