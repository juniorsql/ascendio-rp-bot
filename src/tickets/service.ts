import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits as P, StringSelectMenuBuilder, type Client, type Guild, type GuildMember, type OverwriteResolvable, type TextChannel, type ThreadChannel } from 'discord.js';
import { errorCode, log } from '../logs/logger.js';
import { safeText, text, UserError } from '../validation/input.js';
import { departments, ticketLabels, TicketStore, type Department, type Ticket } from './store.js';
import { accessRole, assertHub, ensureHubs, findThread, grantHubAccess, threadName } from './thread-hubs.js';
import { assertNotificationChannel, ensureNotificationChannels, openingNotice } from './notifications.js';

const none = { parse: [] as never[], repliedUser: false };
const read = [P.ViewChannel, P.ReadMessageHistory];
const write = [...read, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.AddReactions];
const never = [P.MentionEveryone, P.CreatePublicThreads, P.CreatePrivateThreads, P.SendMessagesInThreads];
export function ticketOverwrites(guildId: string, botId: string, ownerId: string, roleIds: string[], closed = false): OverwriteResolvable[] {
  if ([guildId, botId].includes(ownerId) || roleIds.includes(guildId) || roleIds.includes(botId)) throw new UserError('Participantes do ticket inválidos.');
  const allow = closed ? read : write;
  const deny = closed ? [...never, P.SendMessages, P.AddReactions] : never;
  return [
    { id: guildId, type: 0, deny: [P.ViewChannel, ...never] },
    ...[...new Set(roleIds)].map(id => ({ id, type: 0 as const, allow, deny })),
    { id: ownerId, type: 1, allow, deny },
    { id: botId, type: 1, allow: [...write, P.ManageChannels, P.ManageRoles], deny: never },
  ];
}
export function ticketStaff(member: GuildMember, ticket: Pick<Ticket, 'roleIds'>): boolean {
  return !member.user.bot && (member.permissions.has(P.Administrator) || ticket.roleIds.some(id => member.roles.cache.has(id)));
}
export function ticketControls(t: Ticket) {
  const closed = t.status === 'closed' || t.status === 'closing';
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${t.id}`).setLabel(t.claimedBy ? 'Atendimento assumido' : 'Assumir atendimento').setStyle(ButtonStyle.Primary).setDisabled(closed || !!t.claimedBy),
    new ButtonBuilder().setCustomId(`ticket:close:${t.id}`).setLabel(closed ? 'Atendimento encerrado' : 'Encerrar ticket').setStyle(ButtonStyle.Secondary).setDisabled(closed),
  )];
}
export function ticketPanel(threads = false) {
  return {
    embeds: [{ color: 0xb49a61, title: 'CENTRAL DE ATENDIMENTO', description: `Precisa falar com a equipe do Ascendio RP?\n\nSelecione o assunto abaixo e descreva o que você precisa. Um ${threads ? 'tópico' : 'canal'} privado será aberto para você e a equipe responsável.\n\n**Um atendimento por pessoa de cada vez.**${threads ? '\nAo encerrar, a conversa será arquivada, sem exclusão.' : ''}` }],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('ticket:select').setPlaceholder('Selecione o assunto do atendimento').addOptions(...departments.map(d => ({ label: ticketLabels[d].label, value: d, emoji: ticketLabels[d].emoji, description: ticketLabels[d].description }))))],
    allowedMentions: none,
  };
}
function topic(t: Ticket): string { return `ascendio-ticket:v1:${t.id}:${t.ownerId}:${t.department}`; }
function introduction(t: Ticket) {
  const status = t.status === 'closing' || t.status === 'closed' ? 'Encerrado' : t.claimedBy ? `Em atendimento por <@${t.claimedBy}>` : 'Aguardando a equipe';
  return {
    content: `<@${t.ownerId}>`, allowedMentions: none,
    embeds: [{ color: 0xb49a61, title: `${ticketLabels[t.department].emoji} ${ticketLabels[t.department].label}`, description: `**${safeText(t.subject)}**\n\n${safeText(t.description)}`, fields: [{ name: 'Situação', value: status }, { name: 'Privacidade', value: 'Este canal é reservado ao solicitante e à equipe responsável. Não envie senhas ou tokens.' }] }],
    components: ticketControls(t),
  };
}
export class Tickets {
  private locks = new Set<string>();
  constructor(readonly client: Client, readonly guildId: string, readonly store: TicketStore) {}
  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.locks.has(key)) throw new UserError('Essa solicitação já está sendo processada. Aguarde alguns instantes.');
    this.locks.add(key); try { return await fn(); } finally { this.locks.delete(key); }
  }
  private async guild(): Promise<Guild> { return this.client.guilds.fetch(this.guildId); }
  private async channel(id: string): Promise<TextChannel | ThreadChannel> {
    const ch = await this.client.channels.fetch(id, { force: true });
    if (!ch || (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.PrivateThread) || ch.guildId !== this.guildId) throw new UserError('Canal de atendimento indisponível. Confira a configuração.');
    return ch;
  }
  private async textChannel(id: string): Promise<TextChannel> {
    const ch = await this.channel(id);
    if (ch.type !== ChannelType.GuildText) throw new UserError('Selecione um canal de texto para a central ou os registros.');
    return ch;
  }
  async member(userId: string): Promise<GuildMember> {
    const member = await (await this.guild()).members.fetch({ user: userId, force: true });
    if (member.user.bot) throw new UserError('Bots não podem abrir ou assumir atendimentos.');
    return member;
  }
  async checkConfig(c = this.store.snapshot().config, checkHubs = true): Promise<void> {
    const guild = await this.guild();
    const me = await guild.members.fetchMe({ force: true });
    if (!me.permissions.has([P.ManageChannels, P.ManageRoles])) throw new UserError('O bot precisa de Gerenciar canais e Gerenciar permissões para os tickets.');
    const panel = await this.textChannel(c.panelChannelId), logs = await this.textChannel(c.logChannelId);
    if (panel.id === logs.id) throw new UserError('Use um canal privado separado para os registros.');
    for (const ch of [panel, logs]) if (!ch.permissionsFor(me)?.has([...write, P.ManageChannels, P.ManageRoles])) throw new UserError('O bot não possui as permissões necessárias no painel ou nos registros.');
    // Logs de tickets nunca são publicados em canal aberto ao cargo @everyone.
    if (logs.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new UserError('O canal de registros precisa ser privado.');
    const categories = [...(c.mode === 'thread' ? [] : [c.closedCategoryId]), ...departments.map(d => c.routes[d].categoryId)];
    for (const id of categories) {
      const ch = await guild.channels.fetch(id, { force: true });
      if (!ch || ch.type !== ChannelType.GuildCategory || !ch.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels, P.ManageRoles])) throw new UserError('Categoria de tickets indisponível ou sem permissão para o bot.');
    }
    for (const d of departments) {
      if (!c.routes[d].roleIds.length) throw new UserError('Defina ao menos um cargo responsável por cada atendimento.');
      for (const id of c.routes[d].roleIds) {
        const role = await guild.roles.fetch(id);
        if (!role || role.id === guild.id || role.managed) throw new UserError('Escolha cargos próprios da equipe, sem @everyone ou integrações.');
      }
      if (c.mode === 'thread' && checkHubs) {
        await accessRole(guild, c.routes[d].accessRoleId ?? '', d);
        const hub = await this.textChannel(c.routes[d].parentChannelId ?? '');
        assertHub(hub, guild.id, this.client.user!.id, d, c.routes[d]);
        if (!hub.permissionsFor(me)?.has([P.ViewChannel, P.ReadMessageHistory, P.CreatePrivateThreads, P.ManageThreads, P.SendMessagesInThreads])) throw new UserError('O bot precisa criar, gerenciar e enviar mensagens em tópicos privados na central.');
      }
    }
  }
  async enableThreads(): Promise<void> {
    return this.exclusive('setup', async () => {
      const config = this.store.snapshot().config;
      await this.checkConfig({ ...config, mode: 'thread' }, false);
      const hubs = await ensureHubs(await this.guild(), config, this.client.user!.id);
      const alerts = await ensureNotificationChannels(await this.guild(), config, this.client.user!.id);
      await this.store.transact(s => { for (const d of departments) Object.assign(s.config.routes[d], hubs[d], { notificationChannelId: alerts[d] }); s.config.mode = 'thread'; });
      await this.checkConfig();
    });
  }
  async ensurePanel(): Promise<string> {
    return this.exclusive('panel', async () => {
      const state = this.store.snapshot();
      await this.checkConfig();
      const ch = await this.textChannel(state.config.panelChannelId);
      const previous = state.panelMessageId ? await ch.messages.fetch(state.panelMessageId).catch(e => { if (e.code !== 10008) throw e; return null; }) : null;
      if (previous) {
        if (previous.author.id !== this.client.user!.id) throw new UserError('O painel salvo não pertence a este bot.');
        await previous.edit(ticketPanel(state.config.mode === 'thread')); return previous.id;
      }
      // Recupera um envio cuja confirmação local tenha sido interrompida.
      const recent = await ch.messages.fetch({ limit: 50 });
      const found = recent.find(m => m.author.id === this.client.user!.id && m.components.some(row => 'components' in row && row.components.some(c => 'customId' in c && c.customId === 'ticket:select')));
      const sent = found ?? await ch.send({ ...ticketPanel(state.config.mode === 'thread'), nonce: `tp${this.guildId}`, enforceNonce: true });
      await this.store.transact(s => { s.panelMessageId = sent.id; });
      return sent.id;
    });
  }
  async assertPanelAccess(userId: string, channelId: string, messageId: string): Promise<void> {
    const s = this.store.snapshot();
    if (channelId !== s.config.panelChannelId || messageId !== s.panelMessageId) throw new UserError('Esse painel não está mais ativo. Use o painel atual de atendimento.');
    const member = await this.member(userId), ch = await this.channel(channelId);
    if (!ch.permissionsFor(member)?.has(P.ViewChannel)) throw new UserError('Você não possui acesso ao canal de atendimento.');
  }
  async open(ownerId: string, d: Department, subject: string, description: string): Promise<Ticket> {
    subject = text(subject, 100, 'Assunto'); description = text(description, 1800, 'Descrição');
    return this.exclusive(`owner:${ownerId}`, async () => {
      const owner = await this.member(ownerId);
      await this.checkConfig();
      const state = this.store.snapshot();
      let t = state.tickets.find(t => t.ownerId === ownerId && t.status !== 'closed');
      if (t && t.status !== 'creating') {
        try {
          await this.channel(t.channelId!);
          if (t.kind === 'thread') await grantHubAccess(owner, state.config.routes[t.department], t.department);
          await this.notifyOpened(t.id);
          return t;
        }
        catch (e) {
          if ((e as { code?: number }).code !== 10003) throw e;
          await this.store.transact(s => { Object.assign(s.tickets.find(r => r.id === t!.id)!, { status: 'closed', closedAt: Date.now(), reason: 'Canal removido manualmente.' }); });
          throw new UserError('O canal anterior foi removido. O registro foi atualizado; tente abrir novamente.');
        }
      }
      if (!t) {
        if (state.tickets.some(t => t.ownerId === ownerId && Date.now() - t.createdAt < 60_000)) throw new UserError('Aguarde um minuto antes de abrir outro ticket.');
        if (state.tickets.filter(t => t.status !== 'closed').length >= 200) throw new UserError('A central atingiu o limite de atendimentos. Procure a administração.');
        const route = state.config.routes[d];
        t = { id: randomUUID().replaceAll('-', '').slice(0, 20), ownerId, department: d, subject, description, categoryId: route.categoryId, roleIds: [...route.roleIds], createdAt: Date.now(), status: 'creating', ...(state.config.mode === 'thread' ? { kind: 'thread' as const, parentChannelId: route.parentChannelId } : {}), ...(route.notificationChannelId ? { notificationStatus: 'pending' as const, notificationChannelId: route.notificationChannelId } : {}) };
        const reservation = t;
        await this.store.transact(s => { if (s.tickets.some(t => t.ownerId === ownerId && t.status !== 'closed')) throw new UserError('Você já tem um ticket em andamento.'); s.tickets.push(reservation); });
      }
      // A reserva sobrevive a erros REST e reinícios: o tópico é a chave de reconciliação.
      const guild = await this.guild();
      if (t.kind === 'thread') await grantHubAccess(owner, state.config.routes[t.department], t.department);
      const channels = await guild.channels.fetch();
      let ch: TextChannel | ThreadChannel | undefined = t.channelId ? await this.channel(t.channelId) : t.kind === 'thread'
        ? t.creationAttempted ? await findThread(await this.textChannel(t.parentChannelId!), t) : undefined
        : channels.find(c => c?.type === ChannelType.GuildText && c.topic === topic(t!)) as TextChannel | undefined;
      if (!ch) {
        if (t.creationAttempted) throw new UserError('A abertura anterior ficou sem confirmação. A equipe precisa conferir o registro pendente antes de liberar uma nova tentativa.');
        await this.store.transact(s => { s.tickets.find(r => r.id === t!.id)!.creationAttempted = true; });
        t.creationAttempted = true;
        try {
          if (t.kind === 'thread') {
            const parent = await this.textChannel(t.parentChannelId!);
            ch = await parent.threads.create({ name: threadName(t), type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 1440, reason: 'Atendimento privado do Ascendio RP' });
          } else ch = await guild.channels.create({ name: `${t.department}-${t.id.slice(0, 6)}`, type: ChannelType.GuildText, parent: t.categoryId, topic: topic(t), permissionOverwrites: ticketOverwrites(guild.id, this.client.user!.id, ownerId, t.roleIds), reason: 'Abertura de atendimento pelo Ascendio RP' });
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status && status >= 400 && status < 500 && status !== 429) await this.store.transact(s => { s.tickets.find(r => r.id === t!.id)!.creationAttempted = false; });
          throw e;
        }
      }
      const channel = ch;
      await this.store.transact(s => { s.tickets.find(r => r.id === t!.id)!.channelId = channel.id; });
      if (ch.type === ChannelType.PrivateThread) {
        if (t.kind !== 'thread' || ch.parentId !== t.parentChannelId || ch.ownerId !== this.client.user!.id) throw new UserError('Tópico de atendimento não corresponde ao registro.');
        if (ch.archived) await ch.setArchived(false, 'Recuperar abertura interrompida');
        await ch.setInvitable(false, 'Privacidade do atendimento');
        await ch.members.add(ownerId);
      }
      if (!t.messageId) {
        const recent = await ch.messages.fetch({ limit: 20 });
        const old = recent.find(m => m.author.id === this.client.user!.id && m.components.some(row => 'components' in row && row.components.some(c => 'customId' in c && c.customId === `ticket:close:${t!.id}`)));
        const message = old ?? await ch.send({ ...introduction(t), nonce: t.id, enforceNonce: true });
        t.messageId = message.id;
      }
      t.channelId = ch.id; t.status = 'open';
      await this.store.transact(s => { Object.assign(s.tickets.find(r => r.id === t!.id)!, t); });
      log('ticket_opened', { userId: ownerId, channelId: ch.id });
      await this.notifyOpened(t.id);
      return t;
    });
  }
  private async notifyOpened(id: string): Promise<void> {
    try {
      await this.exclusive(`notice:${id}`, async () => {
        const t = this.store.snapshot().tickets.find(t => t.id === id);
        if (!t || t.status !== 'open' || !t.notificationStatus || t.notificationStatus === 'sent') return;
        const route = this.store.snapshot().config.routes[t.department];
        const alerts = await this.textChannel(t.notificationChannelId!);
        assertNotificationChannel(alerts, this.guildId, this.client.user!.id, t.department, route);
        const guild = await this.guild(); const me = await guild.members.fetchMe({ force: true });
        if (!alerts.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.MentionEveryone])) throw new UserError('O bot precisa mencionar os cargos no canal privado de avisos.');
        const roles = t.roleIds.filter(id => route.roleIds.includes(id));
        if (!roles.length) throw new UserError('A equipe do atendimento mudou. Revise o destinatário do aviso.');
        const recent = await alerts.messages.fetch({ limit: 100 });
        const old = recent.find(m => m.author.id === this.client.user!.id && m.content.includes(`Ticket: ${t.id}`));
        if (old) {
          await this.store.transact(s => { Object.assign(s.tickets.find(t => t.id === id)!, { notificationStatus: 'sent', notificationMessageId: old.id }); });
          return;
        }
        // Resultado REST incerto não pode produzir novas menções sem comprovar o envio anterior.
        if (t.notificationStatus === 'sending') throw new UserError('O aviso ficou sem confirmação; a reserva foi preservada para evitar notificações duplicadas.');
        await this.store.transact(s => { s.tickets.find(t => t.id === id)!.notificationStatus = 'sending'; });
        let message;
        try { message = await alerts.send(openingNotice(t, this.guildId, roles)); }
        catch (e) {
          const status = (e as { status?: number }).status;
          if (status && status >= 400 && status < 500 && status !== 429) await this.store.transact(s => { s.tickets.find(t => t.id === id)!.notificationStatus = 'pending'; });
          throw e;
        }
        await this.store.transact(s => { Object.assign(s.tickets.find(t => t.id === id)!, { notificationStatus: 'sent', notificationMessageId: message.id }); });
        log('ticket_opening_notified', { channelId: alerts.id, messageId: message.id, userId: t.ownerId });
      });
    } catch (e) { log('ticket_notification_pending', { code: errorCode(e) }, 'warn'); }
  }
  async getAuthorized(id: string, channelId: string, actorId: string, staffOnly = false): Promise<{ ticket: Ticket; channel: TextChannel | ThreadChannel; member: GuildMember }> {
    const ticket = this.store.snapshot().tickets.find(t => t.id === id);
    if (!ticket || ticket.channelId !== channelId || ticket.status === 'creating') throw new UserError('Ticket não encontrado neste canal.');
    const channel = await this.channel(channelId), member = await this.member(actorId);
    if (!channel.permissionsFor(member)?.has(P.ViewChannel) || (!ticketStaff(member, ticket) && (staffOnly || ticket.ownerId !== actorId))) throw new UserError('Ação restrita ao solicitante e à equipe responsável pelo ticket.');
    if (ticket.kind === 'thread') {
      if (channel.type !== ChannelType.PrivateThread || channel.parentId !== ticket.parentChannelId) throw new UserError('Tópico de atendimento inválido.');
      if (!ticketStaff(member, ticket)) await channel.members.fetch(actorId);
    } else if (channel.type !== ChannelType.GuildText) throw new UserError('Canal do atendimento inválido.');
    return { ticket, channel, member };
  }
  async claim(id: string, channelId: string, actorId: string): Promise<void> {
    return this.exclusive(`ticket:${id}`, async () => {
      const { ticket, channel } = await this.getAuthorized(id, channelId, actorId, true);
      if (ticket.status !== 'open') throw new UserError('Esse ticket já está sendo encerrado ou foi encerrado.');
      if (ticket.claimedBy && ticket.claimedBy !== actorId) throw new UserError('Outro integrante da equipe já assumiu esse atendimento.');
      if (channel.type === ChannelType.PrivateThread) {
        if (channel.archived) await channel.setArchived(false, 'Retomar atendimento ativo');
        // A equipe acessa por Gerenciar tópicos no setor, sem convite permanente adicional.
      }
      await this.store.transact(s => { s.tickets.find(t => t.id === id)!.claimedBy = actorId; });
      ticket.claimedBy = actorId;
      if (ticket.messageId) await (await channel.messages.fetch(ticket.messageId)).edit(introduction(ticket));
      log('ticket_claimed', { userId: actorId, channelId });
    });
  }
  async close(id: string, channelId: string, actorId: string, reason: string): Promise<void> {
    return this.exclusive(`ticket:${id}`, async () => {
      const { ticket } = await this.getAuthorized(id, channelId, actorId);
      if (ticket.status === 'closed') return;
      reason = text(reason, 500, 'Motivo', 0) || 'Atendimento concluído.';
      if (ticket.status !== 'closing') await this.store.transact(s => { Object.assign(s.tickets.find(t => t.id === id)!, { status: 'closing', closedBy: actorId, closedAt: Date.now(), reason }); });
      await this.finishClose(id);
    });
  }
  private async finishClose(id: string): Promise<void> {
    let ticket = this.store.snapshot().tickets.find(t => t.id === id)!;
    const c = this.store.snapshot().config;
    const channel = await this.channel(ticket.channelId!);
    const isThread = ticket.kind === 'thread';
    if (isThread) {
      if (channel.type !== ChannelType.PrivateThread || channel.parentId !== ticket.parentChannelId) throw new UserError('Tópico de atendimento inválido.');
      if (channel.archived) await channel.setArchived(false, 'Concluir encerramento pendente');
      await channel.setLocked(true, 'Encerrar atendimento sem excluir a conversa');
    } else {
      if (channel.type !== ChannelType.GuildText) throw new UserError('Canal de atendimento inválido.');
      // Compatibilidade: canais antigos mantêm seu histórico e permissões.
      await channel.edit({ name: `fechado-${ticket.department}-${ticket.id.slice(0, 6)}`, permissionOverwrites: ticketOverwrites(this.guildId, this.client.user!.id, ticket.ownerId, ticket.roleIds, true), reason: 'Encerramento de ticket com histórico preservado' });
      const parent = await (await this.guild()).channels.fetch(c.closedCategoryId, { force: true });
      if (!parent || parent.type !== ChannelType.GuildCategory) throw new UserError('Categoria de arquivamento indisponível. O canal já foi bloqueado e o histórico foi preservado.');
      const allChannels = await (await this.guild()).channels.fetch();
      // Categorias do Discord comportam 50 canais. Se lotar, fica fechado na categoria atual.
      if (channel.parentId !== parent.id && allChannels.filter(ch => ch?.parentId === parent.id).size < 50) await channel.setParent(parent.id, { lockPermissions: false, reason: 'Arquivar atendimento encerrado' });
    }
    ticket = { ...ticket, status: 'closed' };
    if (ticket.messageId) {
      try { await (await channel.messages.fetch(ticket.messageId)).edit(introduction(ticket)); }
      catch (e) { if ((e as { code?: number }).code !== 10008) throw e; }
    }
    // Arquivar depois de editar a mensagem evita a reabertura implícita causada pelo envio.
    if (channel.type === ChannelType.PrivateThread) await channel.edit({ archived: true, locked: true, invitable: false, reason: 'Conversa preservada em tópico privado arquivado' });
    if (!ticket.logMessageId) {
      const logs = await this.textChannel(c.logChannelId);
      const guild = await this.guild();
      if (logs.permissionsFor(guild.roles.everyone)?.has(P.ViewChannel)) throw new UserError('O registro não foi enviado: o canal de logs deixou de ser privado. O histórico continua no ticket.');
      const recent = await logs.messages.fetch({ limit: 50 });
      const marker = `Ticket: ${ticket.id}`;
      const old = recent.find(m => m.author.id === this.client.user!.id && m.content.includes(marker));
      const sent = old ?? await logs.send({ content: `**Atendimento encerrado • ${ticketLabels[ticket.department].label}**\n${marker}\nSolicitante: <@${ticket.ownerId}>\nResponsável: <@${ticket.closedBy}>\n${ticket.claimedBy ? `Atendido por: <@${ticket.claimedBy}>\n` : ''}Motivo: ${safeText(ticket.reason ?? '')}\nHistórico preservado: <#${channel.id}>`, allowedMentions: none, nonce: `close${ticket.id}`, enforceNonce: true });
      ticket.logMessageId = sent.id;
    }
    await this.store.transact(s => { Object.assign(s.tickets.find(t => t.id === id)!, ticket); });
    log('ticket_closed', { userId: ticket.closedBy, channelId: channel.id });
  }
  async recover(): Promise<void> {
    const creating = this.store.snapshot().tickets.filter(t => t.status === 'creating');
    if (creating.length) {
      const channels = await (await this.guild()).channels.fetch();
      for (const t of creating) {
        if (t.kind === 'thread') {
          if (!await findThread(await this.textChannel(t.parentChannelId!), t)) continue;
        } else if (!channels.some(ch => ch?.type === ChannelType.GuildText && ch.topic === topic(t))) continue;
        try { await this.open(t.ownerId, t.department, t.subject, t.description); }
        catch (e) { log('ticket_recovery_pending', { channelId: t.channelId, code: errorCode(e) }, 'warn'); }
      }
    }
    for (const t of this.store.snapshot().tickets.filter(t => t.status === 'closing')) {
      try { await this.exclusive(`ticket:${t.id}`, () => this.finishClose(t.id)); }
      catch (e) { log('ticket_recovery_pending', { channelId: t.channelId, code: errorCode(e) }, 'warn'); }
    }
    for (const t of this.store.snapshot().tickets.filter(t => t.status === 'open' && ['pending', 'sending'].includes(t.notificationStatus ?? ''))) await this.notifyOpened(t.id);
  }
}
