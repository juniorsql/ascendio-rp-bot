import { AttachmentBuilder, MessageFlags, PermissionFlagsBits, type Client, type Interaction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type APIEmbed } from 'discord.js';
import type { Env } from '../config/env.js';
import { kinds, palette, type Kind } from '../config/defaults.js';
import { controls, form, postForm } from '../components/forms.js';
import { errorCode, log } from '../logs/logger.js';
import { Drafts, publish, type Draft } from '../services/drafts.js';
import { authorized, target } from '../services/discord.js';
import type { Store } from '../services/store.js';
import { postEmbed, rulesEmbeds, welcomeEmbed, type Post } from '../templates/embeds.js';
import { color, fields, imageUrl, safeText, text, UserError } from '../validation/input.js';
export interface Context { client: Client; env: Env; store: Store; drafts: Drafts }
type Usable = ChatInputCommandInteraction | ModalSubmitInteraction | Extract<Interaction, { customId: string }>;
const none = { parse: [] as never[], repliedUser: false };
function kindOf(value: string): Kind {
  if (!(kinds as readonly string[]).includes(value)) throw new UserError('Tipo de publicação inválido.');
  return value as Kind;
}
async function currentMember(i: Usable, ctx: Context, configure = false) {
  if (!i.guild || i.guildId !== ctx.env.guildId) throw new UserError('Este bot está restrito ao servidor configurado.');
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (!authorized(member, ctx.store.snapshot().config, configure)) throw new UserError(configure ? 'Você precisa da permissão Gerenciar servidor.' : 'Acesso restrito à administração ou aos cargos autorizados.');
  return member;
}
async function destination(i: Usable, ctx: Context, channelId: string) {
  const ch = await target(ctx.client, ctx.env.guildId, channelId);
  const member = await currentMember(i, ctx);
  if (!ch.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw new UserError('Você precisa de acesso para ver e enviar mensagens no destino.');
  return ch;
}
async function audit(ctx: Context, userId: string, action: string, channelId?: string, messageId?: string) {
  log(action, { guildId: ctx.env.guildId, userId, channelId, messageId });
  const logId = ctx.store.snapshot().config.logChannelId;
  if (!logId) return;
  try {
    const ch = await target(ctx.client, ctx.env.guildId, logId);
    await ch.send({ content: `**Ascendio RP • Registro administrativo**\nAção: \`${action}\`\nResponsável: ${userId}${channelId ? `\nCanal: <#${channelId}>` : ''}${messageId && channelId ? `\nPublicação: https://discord.com/channels/${ctx.env.guildId}/${channelId}/${messageId}` : ''}`, allowedMentions: none });
  } catch (error) { log('audit_channel_failed', { code: errorCode(error) }, 'warn'); }
}
async function changed(ctx: Context, userId: string, action: string, mutate: (config: ReturnType<Store['snapshot']>['config']) => void) {
  await ctx.store.transact(state => { mutate(state.config); state.audit.push({ time: Date.now(), userId, action }); });
  await audit(ctx, userId, action);
}
function preview(d: Draft) {
  return { content: `**PRÉVIA PRIVADA** • Destino: <#${d.channelId}>\nConfira o conteúdo antes de publicar. Expira em 15 minutos a partir da criação.`, embeds: d.embeds, components: controls(d), allowedMentions: none };
}
async function configCommand(i: ChatInputCommandInteraction, ctx: Context) {
  const config = ctx.store.snapshot().config;
  const sub = i.options.getSubcommand();
  if (sub === 'identidade') return i.showModal(form('cfg:identity', 'Identidade da comunidade', [
    { id: 'name', label: 'Nome do servidor', value: config.name, max: 80 },
    { id: 'footer', label: 'Rodapé padrão', value: config.footer, max: 200 },
    { id: 'logo', label: 'Logotipo original (HTTPS)', value: config.logo, max: 2048, required: false },
  ]));
  if (sub === 'boas-vindas') return i.showModal(form('cfg:welcome', 'Mensagem de boas-vindas', [
    { id: 'title', label: 'Título', value: config.welcomeTitle, max: 200 },
    { id: 'body', label: 'Use {membro}, {servidor} e {regras}', value: config.welcomeText, max: 2500, paragraph: true },
  ]));
  if (sub === 'template') {
    const kind = kindOf(i.options.getString('tipo', true)); const t = config.templates[kind];
    return i.showModal(form(`cfg:template:${kind}`, 'Template de publicação', [
      { id: 'color', label: 'Cor hexadecimal', value: `#${t.color.toString(16).padStart(6, '0')}`, max: 7 },
      { id: 'footer', label: 'Rodapé (vazio usa o padrão)', value: t.footer, max: 200, required: false },
      { id: 'image', label: 'Imagem padrão (HTTPS)', value: t.image, max: 2048, required: false },
      { id: 'thumbnail', label: 'Miniatura padrão (HTTPS)', value: t.thumbnail, max: 2048, required: false },
    ]));
  }
  if (sub === 'regra') {
    const index = i.options.getInteger('categoria', true); const r = config.rules[index];
    if (!r) throw new UserError('Categoria inválida.');
    return i.showModal(form(`cfg:rule:${index}`, 'Editar categoria do regulamento', [
      { id: 'title', label: 'Título da categoria', value: r.title, max: 80 },
      { id: 'body', label: 'Conteúdo definido pela administração', value: r.content, max: 500, paragraph: true },
      { id: 'official', label: 'Conteúdo oficial? Digite sim ou nao', value: r.official ? 'sim' : 'nao', max: 3 },
    ]));
  }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  if (sub === 'ver') {
    const display = (id: string) => id ? `<#${id}>` : 'Desativado';
    return i.editReply({ content: `**${safeText(config.name)} • Configuração**\nBoas-vindas: ${display(config.welcomeChannelId)}\nRegras: ${display(config.rulesChannelId)}\nLogs: ${display(config.logChannelId)}\nCargos de publicação: ${config.adminRoleIds.join(', ') || 'Nenhum'}\nRegras oficiais: ${config.rules.filter(r => r.official).length}/8\nUse os subcomandos para editar a configuração.`, allowedMentions: none });
  }
  if (sub === 'exportar') return i.editReply({ content: 'Configuração sem tokens. Guarde uma cópia em local restrito. Para restauração, veja o README.', files: [new AttachmentBuilder(Buffer.from(JSON.stringify(config, null, 2)), { name: 'ascendio-config.json' })] });
  if (sub === 'historico') {
    const state = ctx.store.snapshot();
    const lines = state.audit.slice(-15).map(a => `${new Date(a.time).toISOString()} • ${a.action} • ${a.userId}${a.messageId ? ` • ${a.messageId}` : ''}`);
    return i.editReply({ content: `**Registro recente**\n${lines.join('\n') || 'Sem ações.'}\n\nReservas pendentes: ${state.receipts.filter(r => r.status === 'sending').length}. Em caso de envio incerto, veja a recuperação no README.`, allowedMentions: none });
  }
  if (sub === 'testar-boas-vindas') return i.editReply({ content: 'Prévia privada. Nenhuma mensagem foi enviada ao canal de recepção.', embeds: welcomeEmbed(config, i.user.id), allowedMentions: none });
  if (sub === 'canal') {
    const usage = i.options.getString('uso', true);
    if (!['welcomeChannelId', 'logChannelId', 'rulesChannelId'].includes(usage)) throw new UserError('Uso do canal inválido.');
    const channelId = i.options.getChannel('destino')?.id ?? '';
    if (channelId) await target(ctx.client, ctx.env.guildId, channelId);
    await changed(ctx, i.user.id, `config_channel_${usage}`, c => { c[usage as 'welcomeChannelId' | 'logChannelId' | 'rulesChannelId'] = channelId; });
  } else if (sub === 'cargo') {
    const role = i.options.getRole('cargo', true);
    if (role.id === i.guildId || role.managed) throw new UserError('Escolha um cargo próprio da equipe; @everyone e cargos de integrações não são aceitos.');
    const add = i.options.getString('acao', true) === 'adicionar';
    await changed(ctx, i.user.id, add ? 'config_role_add' : 'config_role_remove', c => { c.adminRoleIds = add ? [...new Set([...c.adminRoleIds, role.id])] : c.adminRoleIds.filter(id => id !== role.id); });
  } else throw new UserError('Subcomando desconhecido.');
  return i.editReply({ content: 'Configuração salva. A alteração já está em vigor.' });
}
async function configModal(i: ModalSubmitInteraction, ctx: Context) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const [, action, key] = i.customId.split(':');
  const value = (name: string) => i.fields.getTextInputValue(name).trim();
  await changed(ctx, i.user.id, `config_${action}`, c => {
    if (action === 'identity') { c.name = text(value('name'), 80); c.footer = text(value('footer'), 200); c.logo = imageUrl(value('logo')); }
    else if (action === 'welcome') { c.welcomeTitle = text(value('title'), 200); c.welcomeText = text(value('body'), 2500); }
    else if (action === 'template') {
      const kind = kindOf(key ?? '');
      c.templates[kind] = { color: color(value('color')), footer: text(value('footer'), 200, 'Rodapé', 0), image: imageUrl(value('image')), thumbnail: imageUrl(value('thumbnail')) };
    } else if (action === 'rule') {
      const index = Number(key); if (!Number.isInteger(index) || !c.rules[index]) throw new UserError('Categoria inválida.');
      if (!['sim', 'nao', 'não'].includes(value('official').toLowerCase())) throw new UserError('Informe sim ou nao para o status oficial.');
      c.rules[index] = { title: text(value('title'), 80), content: text(value('body'), 500), official: value('official').toLowerCase() === 'sim' };
    } else throw new UserError('Formulário desconhecido.');
  });
  return i.editReply({ content: 'Configuração salva com sucesso.' });
}
async function handle(i: Interaction, ctx: Context) {
  if (!i.isChatInputCommand() && !i.isModalSubmit() && !i.isButton() && !i.isStringSelectMenu()) return;
  if (i.isChatInputCommand() && i.commandName === 'ajuda') {
    if (i.guildId !== ctx.env.guildId) throw new UserError('Este bot está restrito ao servidor configurado.');
    return i.reply({ content: '**Ascendio RP • Orientações**\nConsulte os canais de regras e ambientação antes de iniciar sua história.\n\n**Equipe:** use /anuncio, /evento, /spoiler ou /comunicado para compor uma publicação. Revise a prévia privada e confirme. /regras reúne o regulamento. /configurar edita os canais, cargos, identidade e templates.\n\nPublicações exigem Gerenciar mensagens ou um cargo autorizado. Configurações exigem Gerenciar servidor.', flags: MessageFlags.Ephemeral });
  }
  const configuring = (i.isChatInputCommand() && i.commandName === 'configurar') || (i.isModalSubmit() && i.customId.startsWith('cfg:'));
  await currentMember(i, ctx, configuring);
  if (i.isChatInputCommand()) {
    if (i.commandName === 'configurar') return configCommand(i, ctx);
    if (!['anuncio', 'evento', 'spoiler', 'comunicado', 'regras'].includes(i.commandName)) throw new UserError('Comando desconhecido.');
    const channelId = i.options.getChannel('canal', true).id;
    if (i.commandName === 'regras') {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await destination(i, ctx, channelId);
      const draft = ctx.drafts.create({ ownerId: i.user.id, guildId: ctx.env.guildId, channelId, embeds: rulesEmbeds(ctx.store.snapshot().config) });
      return i.editReply(preview(draft));
    }
    const kind = kindOf(i.commandName === 'anuncio' ? i.options.getString('tipo', true) : i.commandName);
    return i.showModal(postForm(`post:new:${kind}:${channelId}`));
  }
  if (i.isModalSubmit()) {
    if (i.customId.startsWith('cfg:')) return configModal(i, ctx);
    const [prefix, action, key, channel] = i.customId.split(':');
    if (prefix !== 'post' || !['new', 'edit'].includes(action ?? '')) throw new UserError('Formulário desconhecido.');
    if (i.isFromMessage()) await i.deferUpdate(); else await i.deferReply({ flags: MessageFlags.Ephemeral });
    const old = action === 'edit' ? ctx.drafts.get(key!, i.user.id, ctx.env.guildId) : undefined;
    const channelId = old?.channelId ?? channel!;
    await destination(i, ctx, channelId);
    const post: Post = { kind: old?.post?.kind ?? kindOf(key!), title: text(i.fields.getTextInputValue('title'), 256, 'Título'),
      description: text(i.fields.getTextInputValue('description'), 4000, 'Conteúdo'), image: imageUrl(i.fields.getTextInputValue('image')),
      thumbnail: imageUrl(i.fields.getTextInputValue('thumbnail')), fields: fields(i.fields.getTextInputValue('fields')), ...(old?.post?.color !== undefined ? { color: old.post.color } : {}) };
    const embeds = postEmbed(post, ctx.store.snapshot().config);
    if (old) ctx.drafts.get(old.id, i.user.id, ctx.env.guildId);
    const draft = old ?? ctx.drafts.create({ ownerId: i.user.id, guildId: ctx.env.guildId, channelId, post, embeds });
    draft.post = post; draft.embeds = embeds;
    return i.editReply(preview(draft));
  }
  const [action, id] = i.customId.split(':');
  const draft = ctx.drafts.get(id!, i.user.id, ctx.env.guildId);
  if (i.isButton() && action === 'edit') return i.showModal(postForm(`post:edit:${draft.id}`, draft));
  if (i.isButton() && action === 'confirm') {
    // Trava antes da primeira espera: cancelar/editar não pode ultrapassar a confirmação.
    draft.busy = true;
    try {
      await i.deferUpdate();
      const ch = await destination(i, ctx, draft.channelId);
      draft.busy = false;
      const messageId = await publish(draft, ctx.store, (embeds: APIEmbed[], nonce: string) => ch.send({ embeds, allowedMentions: none, nonce, enforceNonce: true }));
      ctx.drafts.remove(draft.id);
      await audit(ctx, i.user.id, 'publication_sent', ch.id, messageId);
      return i.editReply({ content: `Publicação enviada: https://discord.com/channels/${ctx.env.guildId}/${ch.id}/${messageId}`, embeds: [], components: [] });
    } finally { draft.busy = false; }
  }
  await i.deferUpdate();
  ctx.drafts.get(draft.id, i.user.id, ctx.env.guildId);
  if (i.isButton() && action === 'cancel') {
    ctx.drafts.remove(draft.id);
    await ctx.store.transact(s => { s.audit.push({ time: Date.now(), action: 'publication_cancelled', userId: i.user.id, channelId: draft.channelId }); });
    log('publication_cancelled', { userId: i.user.id, channelId: draft.channelId });
    return i.editReply({ content: 'Publicação cancelada.', embeds: [], components: [] });
  }
  if (i.isStringSelectMenu() && action === 'theme' && draft.post) {
    const selection = i.values[0];
    const value = Number(selection);
    if (!(Object.values(palette) as number[]).includes(value)) throw new UserError('Cor inválida.');
    const updated = { ...draft.post, color: value };
    const embeds = postEmbed(updated, ctx.store.snapshot().config);
    draft.post = updated; draft.embeds = embeds;
    return i.editReply(preview(draft));
  }
  throw new UserError('Componente desconhecido.');
}
export async function onInteraction(i: Interaction, ctx: Context): Promise<void> {
  try { await handle(i, ctx); }
  catch (error) {
    log(error instanceof UserError ? 'interaction_rejected' : 'interaction_failed', { userId: i.user.id, guildId: i.guildId ?? undefined, code: errorCode(error) }, error instanceof UserError ? 'warn' : 'error');
    if (!i.isRepliable()) return;
    const content = error instanceof UserError ? error.message : 'Não foi possível concluir a ação. Confira as permissões, o armazenamento e os logs; depois tente novamente.';
    try {
      if (i.replied || i.deferred) await i.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: none });
      else await i.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: none });
    } catch (replyError) { log('interaction_reply_failed', { code: errorCode(replyError) }, 'warn'); }
  }
}
