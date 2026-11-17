import { escapeMarkdown, MessageFlags, OverwriteType, PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { Context } from '../commands/handler.js';
import { errorCode, log } from '../logs/logger.js';
import { target } from '../services/discord.js';
import { departureLimit, type Departure } from '../services/store.js';
import { UserError } from '../validation/input.js';

function departureLine(entry: Departure): string {
  const account = entry.username ? escapeMarkdown(entry.username) : 'Conta do Discord';
  return `**${account}** · \`${entry.userId}\` · <t:${Math.floor(entry.at / 1000)}:f>`;
}

export async function onMemberRemove(member: GuildMember | PartialGuildMember, ctx: Context): Promise<void> {
  if (member.guild.id !== ctx.env.guildId || member.user.bot) return;
  const departure = { userId: member.id, username: member.user.username ?? '', at: Date.now() };
  try {
    await ctx.store.transact(state => {
      state.departures = [...(state.departures ?? []), departure].slice(-departureLimit);
    });
  } catch (error) {
    log('departure_record_failed', { code: errorCode(error) }, 'error');
  }
  const { departureChannelId, clientId } = ctx.env;
  if (!departureChannelId) return;
  try {
    const channel = await target(ctx.client, member.guild.id, departureChannelId);
    const overwrites = channel.permissionOverwrites.cache;
    const everyone = overwrites.get(member.guild.id);
    const view = PermissionFlagsBits.ViewChannel;
    const explicitViewer = [...overwrites.values()].some(overwrite =>
      overwrite.allow.has(view, false)
      && (overwrite.type !== OverwriteType.Member || ![clientId, channel.guild.ownerId].includes(overwrite.id)));
    if (everyone?.type !== OverwriteType.Role || !everyone.deny.has(view, false) || explicitViewer) {
      log('departure_notice_blocked_permissions', { channelId: departureChannelId }, 'warn');
      return;
    }
    await channel.send({
      embeds: [{ title: '📤 Membro saiu do servidor', description: departureLine(departure), color: 0xb69a60 }],
      allowedMentions: { parse: [] },
    });
    log('departure_notice_sent', { channelId: departureChannelId });
  } catch (error) {
    log('departure_notice_failed', { channelId: departureChannelId, code: errorCode(error) }, 'warn');
  }
}

export async function showDepartures(interaction: ChatInputCommandInteraction, ctx: Context) {
  if (!interaction.guild || interaction.guildId !== ctx.env.guildId || interaction.user.id !== interaction.guild.ownerId) {
    throw new UserError('A lista de saídas é privada para o dono do servidor.');
  }
  const departures = ctx.store.snapshot().departures ?? [];
  const pageSize = 15;
  const lastPage = Math.max(1, Math.ceil(departures.length / pageSize));
  const page = interaction.options.getInteger('pagina') ?? 1;
  if (page < 1 || page > lastPage) throw new UserError(`Escolha uma página entre 1 e ${lastPage}.`);
  const start = departures.length - (page - 1) * pageSize;
  const lines = departures.slice(Math.max(0, start - pageSize), start).reverse().map(entry => `• ${departureLine(entry)}`);
  const content = lines.length
    ? `**Saídas do servidor** · Página ${page}/${lastPage}\n\n${lines.join('\n')}`
    : 'Ainda não há saídas registradas.';
  return interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
