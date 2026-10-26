import type { GuildMember } from 'discord.js';
import type { Context } from '../commands/handler.js';
import { target } from '../services/discord.js';
import { welcomeEmbed } from '../templates/embeds.js';
import { errorCode, log } from '../logs/logger.js';
import { assignJoinRole } from './member-role.js';
export async function onMemberAdd(member: GuildMember, ctx: Context): Promise<void> {
  if (member.guild.id !== ctx.env.guildId || member.user.bot) return;
  await assignJoinRole(member, ctx);
  const config = ctx.store.snapshot().config;
  if (!config.welcomeChannelId) return;
  try {
    const ch = await target(ctx.client, member.guild.id, config.welcomeChannelId);
    const message = await ch.send({ content: `<@${member.id}>`, embeds: welcomeEmbed(config, member.id), allowedMentions: { parse: [], users: [member.id] } });
    log('welcome_sent', { userId: member.id, channelId: ch.id, messageId: message.id });
  } catch (error) { log('welcome_failed', { userId: member.id, code: errorCode(error) }, 'error'); }
}
