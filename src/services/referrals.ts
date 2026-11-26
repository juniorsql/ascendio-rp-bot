import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, escapeMarkdown, type Client, type Guild, type GuildMember, type Interaction } from 'discord.js';
import { form } from '../components/forms.js';
import { joinRole } from '../events/member-role.js';
import { errorCode } from '../logs/logger.js';
import { safeText, snowflake, UserError } from '../validation/input.js';
import { target } from './discord.js';

interface ReferralConfig {
  channelId: string;
  recordChannelId?: string;
  inviterRoleId: string;
  referredRoleId: string;
  rulesChannelId?: string;
  loreChannelId?: string;
}
interface Referral { id: string; inviterId: string; referredId: string; at: number; messageId?: string }
const openId = 'referral:open';
const responsibility = 'Quem indica assume a responsabilidade pela indicação. Se o indicado descumprir as regras do servidor, quem indicou também será punido pela staff.';
const allowedMentions = { parse: [] as never[] };

export function referralConfig(value?: string): ReferralConfig | undefined {
  if (!value?.trim()) return;
  const config = JSON.parse(value) as Partial<ReferralConfig>;
  return {
    channelId: snowflake(config.channelId ?? ''),
    recordChannelId: config.recordChannelId === undefined ? undefined : snowflake(config.recordChannelId),
    inviterRoleId: snowflake(config.inviterRoleId ?? ''),
    referredRoleId: snowflake(config.referredRoleId ?? ''),
    rulesChannelId: config.rulesChannelId === undefined ? undefined : snowflake(config.rulesChannelId),
    loreChannelId: config.loreChannelId === undefined ? undefined : snowflake(config.loreChannelId),
  };
}

export class Referrals {
  private readonly folder: string;
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly client: Client, private readonly guildId: string, private readonly config: ReferralConfig, dataDir: string) {
    if (new Set([guildId, config.inviterRoleId, config.referredRoleId]).size !== 3) throw new Error('Cargos de indicação inválidos.');
    this.folder = join(dataDir, 'referrals');
  }

  async init() { await mkdir(this.folder, { recursive: true, mode: 0o700 }); }
  async idle() { await Promise.allSettled(this.pending.values()); }

  private get recordChannelId() { return this.config.recordChannelId ?? this.config.channelId; }

  private get reading() {
    const { rulesChannelId, loreChannelId } = this.config;
    const rules = rulesChannelId ? `<#${rulesChannelId}>` : '**Regras**';
    const lore = loreChannelId ? `<#${loreChannelId}>` : '**Profeta Diário**';
    return `Antes da entrevista, oriente a pessoa indicada a ler as ${rules} e o ${lore}, onde estão a lore e a ambientação do servidor.`;
  }

  private async channel(id: string) {
    const channel = await target(this.client, this.guildId, id);
    if (channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) {
      throw new UserError('O canal de indicações precisa ter acesso restrito.');
    }
    return channel;
  }

  async ensurePanel() {
    const channel = await this.channel(this.config.channelId);
    if (this.recordChannelId !== channel.id) await this.channel(this.recordChannelId);
    await joinRole(channel.guild, this.config.referredRoleId);
    const guide = {
      embeds: [{
        title: '⭐ Indicações • Ascendio RP',
        color: 0xb69a60,
        description: '**Como indicar**\n1. Clique em **🪄 Indicar jogador**.\n2. Cole o ID do Discord da pessoa e confira o perfil exibido.\n3. Confirme. O bot registra a indicação e aplica o cargo **⭐ Indicado**.\n\nA staff atribui manualmente o cargo **Aguardando Entrevista** e combina o horário com o indicado.\n\n**Responsabilidade pela indicação**\n' + responsibility,
        fields: [
          { name: 'Leitura para a pessoa indicada', value: this.reading },
          { name: 'Como copiar o ID', value: 'Ative o **Modo desenvolvedor** nas configurações avançadas do Discord. Abra o menu do perfil da pessoa e selecione **Copiar ID de usuário**.' },
        ],
      }],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(openId)
        .setLabel('Indicar jogador').setEmoji('🪄').setStyle(ButtonStyle.Primary))],
      allowedMentions,
    };
    const isGuide = (message: { author: { id: string }; components: unknown[] }) =>
      message.author.id === this.client.user?.id && JSON.stringify(message.components).includes(openId);
    const pins = await channel.messages.fetchPins({ cache: false });
    const pinned = pins.items.find(item => isGuide(item.message))?.message;
    const recent = await channel.messages.fetch({ limit: 50, cache: false });
    const existing = pinned ?? recent.find(isGuide);
    const message = existing ?? await channel.send({ ...guide, nonce: `rf-${channel.id}`, enforceNonce: true });
    if (existing && (existing.embeds[0]?.description !== guide.embeds[0]?.description
      || !existing.embeds[0]?.fields.some(field => field.value === this.reading))) await existing.edit(guide);
    if (!pinned) await message.pin('Guia de indicações do Ascendio RP');
    return message.id;
  }

  private async member(guild: Guild, id: string) {
    try { return await guild.members.fetch({ user: id, force: true, cache: false }); }
    catch (error) {
      if (String(errorCode(error)) === '10007' || String(errorCode(error)) === '10013') {
        throw new UserError('O ID precisa ser de um membro deste servidor.');
      }
      throw error;
    }
  }

  private async candidate(guild: Guild, id: string, inviterId: string) {
    if (id === inviterId) throw new UserError('Escolha outro membro para indicar.');
    const member = await this.member(guild, id);
    if (member.user.bot) throw new UserError('Escolha o perfil de um jogador.');
    if (member.pending) throw new UserError('A pessoa precisa concluir a entrada no servidor antes da indicação.');
    return member;
  }

  private async read(id: string): Promise<Referral | undefined> {
    try { return JSON.parse(await readFile(join(this.folder, `${id}.json`), 'utf8')) as Referral; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  private async save(record: Referral) {
    const path = join(this.folder, `${record.referredId}.json`);
    const file = await open(`${path}.tmp`, 'w', 0o600);
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
    finally { await file.close(); }
    await rename(`${path}.tmp`, path);
  }

  private async register(inviterId: string, member: GuildMember, id: string) {
    if (this.pending.has(member.id)) throw new UserError('Já existe uma indicação em andamento para esse jogador.');
    const work = this.complete(inviterId, member, id);
    this.pending.set(member.id, work);
    try { return await work; }
    finally { this.pending.delete(member.id); }
  }

  private async complete(inviterId: string, member: GuildMember, id: string) {
    const existing = await this.read(member.id);
    if (existing?.messageId || (existing && existing.inviterId !== inviterId)) {
      throw new UserError('Já existe uma indicação registrada ou em andamento para esse jogador.');
    }
    const channel = await this.channel(this.recordChannelId);
    const role = await joinRole(channel.guild, this.config.referredRoleId);
    const record: Referral = existing ?? { id, inviterId, referredId: member.id, at: Date.now() };
    if (!existing) await this.save(record);
    if (!member.roles.cache.has(role.id)) await member.roles.add(role.id, 'Indicação confirmada no painel');
    const footer = `Indicação ${record.id}`;
    let messageId: string | undefined;
    if (existing) {
      let before: string | undefined;
      while (!messageId) {
        const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
        messageId = messages.find(message => message.author.id === this.client.user?.id && message.embeds[0]?.footer?.text === footer)?.id;
        const oldest = messages.last();
        if (messages.size < 100 || !oldest || oldest.createdTimestamp < record.at) break;
        before = oldest.id;
      }
    }
    record.messageId = messageId ?? (await channel.send({
      embeds: [{
        title: '⭐ Indicação registrada',
        color: 0xb69a60,
        fields: [
          { name: 'Indicado', value: `<@${member.id}> · ${safeText(escapeMarkdown(member.user.username))}` },
          { name: 'ID do Discord', value: member.id, inline: true },
          { name: 'Responsável pela indicação', value: `<@${inviterId}>`, inline: true },
          { name: 'Próxima etapa', value: `A staff atribui manualmente o cargo **Aguardando Entrevista**.\n${this.reading}` },
        ],
        description: responsibility,
        footer: { text: footer },
      }],
      allowedMentions, nonce: `rf-${record.id}`, enforceNonce: true,
    })).id;
    await this.save(record);
    return record.messageId;
  }

  async handle(i: Interaction) {
    if (!i.guild || i.guildId !== this.guildId || i.channelId !== this.config.channelId) {
      throw new UserError('Abra o painel no canal de indicações.');
    }
    if (!i.isButton() && !i.isModalSubmit()) return;
    const roles = i.member?.roles;
    if (!(Array.isArray(roles) ? roles.includes(this.config.inviterRoleId) : roles?.cache.has(this.config.inviterRoleId))) {
      throw new UserError('Você precisa do cargo 🪄 Pode indicar para usar este painel.');
    }
    if (i.isButton() && i.customId === openId) return i.showModal(form('referral:lookup', 'Indicar jogador', [
      { id: 'user', label: 'ID do Discord do indicado', max: 20, placeholder: 'Cole o ID do usuário' },
    ]));
    if (i.isModalSubmit() && i.customId === 'referral:lookup') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const member = await this.candidate(i.guild, snowflake(i.fields.getTextInputValue('user').trim(), 'ID do indicado'), i.user.id);
      const confirm = new ButtonBuilder().setCustomId(`referral:confirm:${member.id}:${i.user.id}`)
        .setStyle(ButtonStyle.Success).setLabel('Confirmar indicação');
      return i.editReply({
        content: `**Confira o perfil**\n${safeText(escapeMarkdown(member.displayName))} (@${safeText(escapeMarkdown(member.user.username))}) · <@${member.id}>\n\n${responsibility}`,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirm)], allowedMentions,
      });
    }
    const [, action, id, inviter] = i.customId.split(':');
    if (i.isButton() && action === 'confirm' && inviter === i.user.id) {
      await i.deferUpdate();
      const actor = await this.member(i.guild, i.user.id);
      if (!actor.roles.cache.has(this.config.inviterRoleId)) throw new UserError('Seu cargo 🪄 Pode indicar é necessário para confirmar.');
      const member = await this.candidate(i.guild, snowflake(id ?? ''), i.user.id);
      const messageId = await this.register(i.user.id, member, i.id);
      return i.editReply({
        content: `⭐ **Indicação registrada.** <@${member.id}> recebeu o cargo **⭐ Indicado**. [Ver registro](https://discord.com/channels/${this.guildId}/${this.recordChannelId}/${messageId}).\n\n${this.reading}`,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
          .setCustomId(openId).setLabel('Indicar outra pessoa').setEmoji('🪄').setStyle(ButtonStyle.Primary))],
        allowedMentions,
      });
    }
    throw new UserError('Abra o formulário de indicação para continuar.');
  }
}
