import { ChannelType, PermissionFlagsBits, PermissionsBitField, type Client, type GuildMember, type GuildTextBasedChannel } from 'discord.js';
import { UserError } from '../validation/input.js';
import type { Config } from '../config/defaults.js';
export function authorized(member: Pick<GuildMember, 'permissions' | 'roles'>, config: Config, configure = false): boolean {
  return member.permissions.has(configure ? PermissionFlagsBits.ManageGuild : PermissionFlagsBits.ManageMessages)
    || (!configure && config.adminRoleIds.some(id => member.roles.cache.has(id)));
}
export async function target(client: Client, guildId: string, channelId: string): Promise<GuildTextBasedChannel & { type: ChannelType.GuildText | ChannelType.GuildAnnouncement }> {
  const ch = await client.channels.fetch(channelId);
  if (!ch || !('guildId' in ch) || ch.guildId !== guildId || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)) throw new UserError('Selecione um canal de texto ou de anúncios deste servidor.');
  const me = ch.guild.members.me ?? await ch.guild.members.fetchMe();
  const needed = new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  if (!ch.permissionsFor(me)?.has(needed)) throw new UserError('O bot precisa de Ver canal, Enviar mensagens e Inserir links no destino.');
  return ch;
}
