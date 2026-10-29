import { MessageFlags, PermissionFlagsBits, type Interaction } from 'discord.js';
import { form } from '../components/forms.js';
import { UserError } from '../validation/input.js';
import type { Context } from '../commands/handler.js';
import { department, ticketLabels } from './store.js';
import { ticketStaff } from './service.js';

export async function ticketInteraction(i: Interaction, ctx: Context): Promise<void> {
  const tickets = ctx.tickets;
  if (!tickets) throw new UserError('A central de tickets ainda não foi iniciada.');
  if (i.guildId !== ctx.env.guildId || !i.guild) throw new UserError('Este bot está restrito ao servidor configurado.');
  if (!i.channelId) throw new UserError('Use a central em um canal do servidor.');
  if (i.isChatInputCommand()) {
    // Configuração e painel exigem permissão administrativa, independentemente do cargo de publicador.
    const member = await tickets.member(i.user.id);
    if (i.commandName === 'atendimentos') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const s = tickets.store.snapshot();
      if (!Object.values(s.config.routes).some(r => ticketStaff(member, r))) throw new UserError('Acesso restrito à equipe de atendimento.');
      const active = s.tickets.filter(t => t.status === 'open' && ticketStaff(member, t));
      // Apenas links dos tickets acessíveis; o comando não adiciona membros aos tópicos.
      const accessible = [];
      for (const t of active.slice(0, 20)) {
        try { await tickets.getAuthorized(t.id, t.channelId!, member.id, true); accessible.push(t); } catch { /* Acesso removido: não exibir. */ }
      }
      const lines = accessible.slice(0, 20).map(t => `${ticketLabels[t.department].emoji} <#${t.channelId}> • ${t.claimedBy ? 'em atendimento' : 'aguardando equipe'}`);
      return void await i.editReply({ content: `**Atendimentos da sua equipe**\n${lines.join('\n') || 'Nenhum atendimento aberto disponível.'}${active.length > 20 ? '\nExibindo até 20 atendimentos. Consulte também os tópicos nas centrais de cada setor.' : ''}`, allowedMentions: { parse: [] } });
    }
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) throw new UserError('Você precisa da permissão Gerenciar servidor.');
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = i.options.getSubcommand();
    if (sub === 'topicos') {
      await tickets.enableThreads(); const id = await tickets.ensurePanel();
      return void await i.editReply(`Tópicos privados ativados. Novos atendimentos serão arquivados sem exclusão. Painel: https://discord.com/channels/${i.guildId}/${tickets.store.snapshot().config.panelChannelId}/${id}`);
    }
    if (sub === 'painel') {
      const id = await tickets.ensurePanel();
      return void await i.editReply(`Painel pronto: https://discord.com/channels/${i.guildId}/${tickets.store.snapshot().config.panelChannelId}/${id}`);
    }
    if (sub === 'recuperar') {
      await tickets.recover();
      const pending = tickets.store.snapshot().tickets.filter(t => t.status === 'creating' || t.status === 'closing').length;
      return void await i.editReply(`Recuperação executada. Registros pendentes: ${pending}. Se houver abertura sem confirmação, confira o canal antes de editar o arquivo de estado; veja docs/TICKETS.md.`);
    }
    if (sub === 'status') {
      const s = tickets.store.snapshot();
      const routes = Object.entries(s.config.routes).map(([d, r]) => `${ticketLabels[department(d)].label}: <#${r.categoryId || '0'}> • ${r.roleIds.map(id => `<@&${id}>`).join(', ') || 'Sem cargo'}`);
      return void await i.editReply({ content: `**Central de atendimento**\nPainel: <#${s.config.panelChannelId || '0'}>\nRegistros: <#${s.config.logChannelId || '0'}>\nArquivo: <#${s.config.closedCategoryId || '0'}>\n${routes.join('\n')}\n\nAtivos: ${s.tickets.filter(t => t.status === 'open').length}\nPendentes de recuperação: ${s.tickets.filter(t => t.status === 'creating' || t.status === 'closing').length}\nAvisos pendentes ou incertos: ${s.tickets.filter(t => t.status === 'open' && ['pending', 'sending'].includes(t.notificationStatus ?? '')).length}\nEncerrados no índice: ${s.tickets.filter(t => t.status === 'closed').length}`, allowedMentions: { parse: [] } });
    }
    if (sub === 'canais') {
      const panelChannelId = i.options.getChannel('painel', true).id;
      const logChannelId = i.options.getChannel('logs', true).id;
      const closedCategoryId = i.options.getChannel('fechados', true).id;
      await tickets.store.transact(s => { if (s.config.panelChannelId !== panelChannelId) delete s.panelMessageId; Object.assign(s.config, { panelChannelId, logChannelId, closedCategoryId }); });
    } else if (sub === 'equipe') {
      const d = department(i.options.getString('tipo', true));
      const categoryId = i.options.getChannel('categoria', true).id;
      const role = i.options.getRole('cargo', true);
      if (role.id === i.guildId || role.managed) throw new UserError('Escolha um cargo próprio da equipe.');
      const remove = i.options.getString('acao') === 'remover';
      await tickets.store.transact(s => { const r = s.config.routes[d]; r.categoryId = categoryId; r.roleIds = remove ? r.roleIds.filter(id => id !== role.id) : [...new Set([...r.roleIds, role.id])]; });
    } else throw new UserError('Subcomando de tickets desconhecido.');
    return void await i.editReply('Configuração salva. Use /ticket painel para validar os acessos e atualizar o painel.');
  }
  if (i.isStringSelectMenu() && i.customId === 'ticket:select') {
    await tickets.assertPanelAccess(i.user.id, i.channelId, i.message.id);
    const d = department(i.values[0] ?? '');
    return void await i.showModal(form(`ticket:open:${d}:${i.message.id}`, ticketLabels[d].label, [
      { id: 'subject', label: 'Assunto', max: 100 },
      { id: 'description', label: 'Descreva o que você precisa', max: 1800, paragraph: true },
    ]));
  }
  if (i.isModalSubmit()) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const [, action, key, panel] = i.customId.split(':');
    if (action === 'open') {
      await tickets.assertPanelAccess(i.user.id, i.channelId, panel ?? '');
      const t = await tickets.open(i.user.id, department(key ?? ''), i.fields.getTextInputValue('subject'), i.fields.getTextInputValue('description'));
      return void await i.editReply(t.status === 'closing' ? 'Seu atendimento está sendo encerrado. Aguarde a conclusão.' : `Seu atendimento está em <#${t.channelId}>. Clique no canal para conversar com a equipe.`);
    }
    if (action === 'finish') {
      await tickets.close(key ?? '', i.channelId, i.user.id, i.fields.getTextInputValue('reason'));
      return void await i.editReply('Atendimento encerrado e arquivado. A conversa foi preservada, sem exclusão.');
    }
    throw new UserError('Formulário de ticket desconhecido.');
  }
  if (i.isButton()) {
    const [, action, id] = i.customId.split(':');
    if (action === 'close') {
      const { ticket } = await tickets.getAuthorized(id ?? '', i.channelId, i.user.id);
      if (ticket.status === 'closed') throw new UserError('Este atendimento já foi encerrado.');
      return void await i.showModal(form(`ticket:finish:${ticket.id}`, 'Encerrar atendimento', [{ id: 'reason', label: 'Motivo do encerramento', max: 500, paragraph: true, required: false }]));
    }
    if (action === 'claim') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await tickets.claim(id ?? '', i.channelId, i.user.id);
      return void await i.editReply('Você assumiu esse atendimento.');
    }
  }
  throw new UserError('Controle de ticket desconhecido.');
}
