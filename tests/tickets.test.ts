import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType, Collection, PermissionFlagsBits as P, PermissionsBitField, type Client, type GuildMember, type Interaction } from 'discord.js';
import { departments, TicketStore, ticketDefaults, ticketSeed } from '../src/tickets/store.js';
import { Tickets, ticketOverwrites, ticketPanel, ticketStaff } from '../src/tickets/service.js';
import { onInteraction, type Context } from '../src/commands/handler.js';
import { hubOverwrites, hubTopic, findThread, threadName } from '../src/tickets/thread-hubs.js';

const guildId = '123456789012345678', botId = '223456789012345678', ownerId = '323456789012345678', staffId = '423456789012345678', outsiderId = '523456789012345678';
const panelId = '623456789012345678', logId = '723456789012345678', closedId = '823456789012345678', roleId = '923456789012345678';
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-tickets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const config = ticketDefaults(); Object.assign(config, { panelChannelId: panelId, logChannelId: logId, closedCategoryId: closedId });
  for (const [n, d] of departments.entries()) config.routes[d] = { categoryId: `13345678901234567${n}`, roleIds: [roleId] };
  const store = new TicketStore(dir); await store.init(config);
  let sequence = 0;
  const id = () => String(153456789012345670n + BigInt(++sequence));
  const all = new PermissionsBitField([P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.ManageChannels, P.ManageRoles, P.CreatePrivateThreads, P.ManageThreads, P.SendMessagesInThreads, P.MentionEveryone]);
  const members = new Map<string, any>([ownerId, staffId, outsiderId, botId].map(userId => [userId, { id: userId, user: { bot: userId === botId }, permissions: userId === botId ? all : new PermissionsBitField(0n), roles: { highest: { comparePositionTo: () => 1 }, cache: new Map(userId === staffId ? [[roleId, {}]] : []) } }]));
  const everyone = { id: guildId, name: '@everyone', managed: false };
  const roles = new Collection<string, any>([[guildId, everyone], [roleId, { id: roleId, name: 'Suporte', managed: false }]]);
  const channels = new Collection<string, any>();
  const creates: any[] = [], threadCreates: any[] = [], edits: any[] = [], sends: any[] = [];
  let unknownCreate = false, failLog = false, failBeforeCreate = false, failInvite = false, failGrant = false;
  let noticeFailure: 'before' | 'after' | null = null;
  function channel(channelId: string, type: ChannelType, overrides: any[] = []) {
    const messages = new Collection<string, any>();
    const ch: any = { id: channelId, guildId, type, topic: '', parentId: null, overrides,
      permissionsFor: (who: any) => {
        if (who.id === botId) return all;
        if (type === ChannelType.PrivateThread) {
          const p = channels.get(ch.parentId).permissionsFor(who);
          return ch.memberIds.has(who.id) || p.has(P.ManageThreads) ? p : new PermissionsBitField(0n);
        }
        if (ch.id === logId || type === ChannelType.GuildCategory) return new PermissionsBitField(0n);
        if (ch.id === panelId) return new PermissionsBitField(P.ViewChannel);
        let bits = 0n;
        const relevant = ch.overrides.filter((o: any) => o.id === guildId || who.roles?.cache.has(o.id));
        for (const o of relevant) bits &= ~new PermissionsBitField(o.deny).bitfield;
        for (const o of relevant) bits |= new PermissionsBitField(o.allow).bitfield;
        const own = ch.overrides.find((o: any) => o.id === who.id && o.type === 1);
        if (own) { bits &= ~new PermissionsBitField(own.deny).bitfield; bits |= new PermissionsBitField(own.allow).bitfield; }
        return new PermissionsBitField(bits);
      },
      messages: { fetch: async (arg: string | { limit: number }) => {
        if (typeof arg !== 'string') return messages;
        const m = messages.get(arg); if (!m) throw Object.assign(new Error('Unknown message'), { code: 10008 }); return m;
      } },
      send: async (body: any) => {
        if (body.nonce) assert.ok(body.nonce.length <= 25);
        if (ch.topic.startsWith('ascendio-ticket-alerts:') && noticeFailure === 'before') throw Object.assign(new Error('Forbidden'), { status: 403 });
        if (channelId === logId && failLog) throw new Error('Log temporarily unavailable');
        sends.push({ channelId, body });
        const m: any = { id: id(), author: { id: botId }, content: body.content ?? '', components: body.components ?? [], edit: async (body: any) => { m.content = body.content ?? ''; m.components = body.components ?? []; edits.push(body); return m; } };
        // Real discord.js messages expose parsed components with customId.
        const normalized = () => { m.components = m.components.map((row: any) => { const json = row.toJSON ? row.toJSON() : row; return { components: json.components.map((c: any) => ({ customId: c.custom_id })) }; }); };
        const edit = m.edit; m.edit = async (body: any) => { await edit(body); normalized(); return m; }; normalized();
        messages.set(m.id, m);
        if (ch.topic.startsWith('ascendio-ticket-alerts:') && noticeFailure === 'after') throw new Error('Timeout after notice delivery');
        return m;
      },
      edit: async (body: any) => {
        if (body.permissionOverwrites) {
          ch.overrides = body.permissionOverwrites;
          ch.permissionOverwrites.cache = new Collection(body.permissionOverwrites.map((o: any) => [o.id, { id: o.id, type: o.type, allow: new PermissionsBitField(o.allow), deny: new PermissionsBitField(o.deny) }]));
        }
        Object.assign(ch, { name: body.name ?? ch.name });
        if (body.parent) ch.parentId = body.parent;
        for (const key of ['archived', 'locked', 'invitable']) if (body[key] !== undefined) ch[key] = body[key];
        edits.push(body); return ch;
      },
      setParent: async (parent: string, options: any) => { assert.equal(options.lockPermissions, false); ch.parentId = parent; return ch; },
      permissionOverwrites: { cache: new Collection(overrides.map((o: any) => [o.id, { id: o.id, type: o.type, allow: new PermissionsBitField(o.allow), deny: new PermissionsBitField(o.deny) }])) },
      memberIds: new Set([botId]),
      members: { add: async (user: string) => { if (failInvite) throw new Error('Member add temporarily failed'); ch.memberIds.add(user); }, fetch: async (user: string | object) => { if (typeof user !== 'string') return new Collection([...ch.memberIds].map((id: string) => [id, { id }])); if (!ch.memberIds.has(user)) throw new Error('Not a member'); return { id: user }; } },
      setArchived: async (value: boolean) => { ch.archived = value; return ch; },
      setLocked: async (value: boolean) => { ch.locked = value; return ch; },
      setInvitable: async (value: boolean) => { ch.invitable = value; return ch; },
      threads: {
        create: async (body: any) => {
          threadCreates.push(body); if (failBeforeCreate) throw new Error('Thread create timeout');
          const thread = channel(id(), ChannelType.PrivateThread); Object.assign(thread, { name: body.name, parentId: ch.id, ownerId: botId, archived: false, locked: false, invitable: body.invitable, archiveTimestamp: Date.now() });
          if (unknownCreate) { unknownCreate = false; throw new Error('Timeout after thread creation'); } return thread;
        },
        fetchActive: async () => ({ threads: channels.filter(c => c.type === ChannelType.PrivateThread && c.parentId === ch.id && !c.archived) }),
        fetchArchived: async () => ({ threads: channels.filter(c => c.type === ChannelType.PrivateThread && c.parentId === ch.id && c.archived), hasMore: false }),
      },
    };
    ch.guild = channels.get(panelId)?.guild;
    channels.set(channelId, ch); return ch;
  }
  channel(panelId, ChannelType.GuildText); channel(logId, ChannelType.GuildText); channel(closedId, ChannelType.GuildCategory);
  for (const d of departments) channel(config.routes[d].categoryId, ChannelType.GuildCategory);
  const guild: any = { id: guildId, roles: { everyone, fetch: async (role?: string) => role ? roles.get(role) : roles, create: async (body: any) => { const role = { ...body, id: id(), managed: false, permissions: new PermissionsBitField(0n) }; roles.set(role.id, role); return role; } }, members: { fetch: async ({ user }: { user: string }) => members.get(user), fetchMe: async () => members.get(botId) }, channels: { fetch: async (id?: string) => id ? channels.get(id) : channels, create: async (body: any) => {
    creates.push(body); if (failBeforeCreate) throw new Error('Timed out before confirmation');
    const ch = channel(id(), body.type, body.permissionOverwrites); Object.assign(ch, { name: body.name, topic: body.topic, parentId: body.parent });
    if (unknownCreate) { unknownCreate = false; throw new Error('Timed out after channel creation'); } return ch;
  } } };
  for (const member of members.values()) {
    member.guild = guild;
    member.roles.add = async (id: string) => { if (failGrant) throw new Error('Role grant failed'); member.roles.cache.set(id, roles.get(id)); return member; };
  }
  for (const ch of channels.values()) ch.guild = guild;
  const client = { user: { id: botId }, guilds: { fetch: async () => guild }, channels: { fetch: async (id: string) => { if (!channels.has(id)) throw Object.assign(new Error('Unknown channel'), { code: 10003 }); return channels.get(id); } } } as unknown as Client;
  const tickets = new Tickets(client, guildId, store);
  return { dir, config, store, tickets, client, guild, members, roles, channels, creates, threadCreates, sends, edits, setNoticeFailure: (value: typeof noticeFailure) => { noticeFailure = value; }, setFailGrant: (value: boolean) => { failGrant = value; }, setFailInvite: (value: boolean) => { failInvite = value; }, setUnknownCreate: () => { unknownCreate = true; }, setFailBeforeCreate: () => { failBeforeCreate = true; }, setFailLog: (value: boolean) => { failLog = value; } };
}

test('restaurar canais preserva tópicos existentes e arquiva novos canais com registro e aviso no ticket', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const old = await f.tickets.open(ownerId, 'suporte', 'Anterior', 'Tópico preservado.');
  const before = f.store.snapshot().tickets;
  await f.tickets.enableChannels();
  assert.equal(f.store.snapshot().config.mode, 'channel');
  assert.deepEqual(f.store.snapshot().tickets, before);
  await f.tickets.close(old.id, old.channelId!, ownerId, 'Fim');
  assert.equal(f.channels.get(old.channelId!)!.archived, true);
  const opened = await f.tickets.open(outsiderId, 'rp', 'Novo', 'Canal individual.');
  const ch = f.channels.get(opened.channelId!)!;
  assert.equal(ch.type, ChannelType.GuildText); assert.equal(opened.kind, undefined);
  assert.equal(ch.parentId, f.config.routes.rp.categoryId);
  const notice = f.sends.filter(m => m.channelId === ch.id && m.body.content?.includes('Novo atendimento'));
  assert.equal(notice.length, 1); assert.deepEqual(notice[0]!.body.allowedMentions.roles, [roleId]);
  assert.deepEqual(notice[0]!.body.allowedMentions.users, []);
  const reopened = new TicketStore(f.dir); await reopened.init();
  await new Tickets(f.client, guildId, reopened).recover();
  assert.equal(reopened.snapshot().config.mode, 'channel');
  assert.equal(f.sends.filter(m => m.channelId === ch.id && m.body.content?.includes('Novo atendimento')).length, 1);
  await f.tickets.close(opened.id, ch.id, outsiderId, 'Concluído');
  assert.equal(ch.parentId, closedId);
  assert.equal(ch.permissionsFor(f.members.get(outsiderId)).has(P.SendMessages), false);
  assert.ok(f.sends.some(m => m.channelId === logId && m.body.content.includes(`<#${ch.id}>`)));
});

test('doações menciona somente responsável individual autorizado e nunca o cargo ou everyone', async t => {
  const f = await fixture(t);
  const routes = structuredClone(f.config.routes);
  routes.doacoes.mentionRoleIds = []; routes.doacoes.mentionUserIds = [staffId];
  await f.tickets.enableChannels(routes);
  const opened = await f.tickets.open(ownerId, 'doacoes', 'Dúvida @everyone', 'Não mencionar <@&123456789012345678>.');
  const notice = f.sends.find(m => m.channelId === opened.channelId && m.body.content?.includes('Novo atendimento'))!;
  assert.deepEqual(notice.body.allowedMentions, { parse: [], roles: [], users: [staffId], repliedUser: false });
  assert.ok(notice.body.content.startsWith(`<@${staffId}>\n`));
  assert.doesNotMatch(notice.body.content, /@everyone|<@&/);
  assert.equal(f.channels.get(opened.channelId!)!.permissionsFor(f.members.get(outsiderId)).has(P.ViewChannel), false);
  await f.tickets.open(ownerId, 'doacoes', 'Repetido', 'Não repetir o aviso.');
  assert.equal(f.sends.filter(m => m.body.content?.includes('Novo atendimento')).length, 1);
});

test('aviso direto bloqueia destinatário sem cargo e não vaza após adulteração de permissões', async t => {
  const f = await fixture(t); const routes = structuredClone(f.config.routes);
  routes.doacoes.mentionRoleIds = []; routes.doacoes.mentionUserIds = [outsiderId];
  await f.tickets.enableChannels(routes);
  const opened = await f.tickets.open(ownerId, 'doacoes', 'Privado', 'Descrição.');
  assert.equal(f.store.snapshot().tickets[0]!.notificationStatus, 'pending');
  assert.equal(f.sends.filter(m => m.body.content?.includes('Novo atendimento')).length, 0);
  f.members.get(outsiderId)!.roles.cache.set(roleId, {});
  const ch = f.channels.get(opened.channelId!)!;
  ch.permissionOverwrites.cache.delete(guildId);
  await f.tickets.recover();
  assert.equal(f.sends.filter(m => m.body.content?.includes('Novo atendimento')).length, 0);
});

test('painel tem os quatro assuntos e publicação repetida atualiza a mesma mensagem', async t => {
  const f = await fixture(t); const id = await f.tickets.ensurePanel();
  assert.equal(await f.tickets.ensurePanel(), id); assert.equal(f.sends.length, 1);
  assert.equal(ticketPanel().components[0]!.toJSON().components[0]!.options!.length, 4);
  const reopened = new TicketStore(f.dir); await reopened.init(); assert.equal(reopened.snapshot().panelMessageId, id);
});
test('usuário comum abre canal privado, estranho não vê, equipe vê e menções não notificam', async t => {
  const f = await fixture(t);
  const opened = await f.tickets.open(ownerId, 'suporte', 'Dúvida @everyone', 'Preciso de ajuda <@&123456789012345678>.');
  assert.equal(opened.status, 'open'); assert.equal(f.creates.length, 1);
  const ch = f.channels.get(opened.channelId!)!;
  assert.equal(ch.permissionsFor(f.members.get(ownerId)).has([P.ViewChannel, P.SendMessages]), true);
  assert.equal(ch.permissionsFor(f.members.get(staffId)).has(P.ViewChannel), true);
  assert.equal(ch.permissionsFor(f.members.get(outsiderId)).has(P.ViewChannel), false);
  assert.equal(ch.permissionsFor(f.members.get(ownerId)).has(P.MentionEveryone), false);
  const message = f.sends[0]!.body;
  assert.deepEqual(message.allowedMentions.parse, []); assert.doesNotMatch(message.embeds[0].description, /@everyone|<@&\d/);
});
test('aberturas concorrentes e outro assunto não criam tickets duplicados', async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.tickets.open(ownerId, 'rp', 'RP', 'Minha proposta.'), f.tickets.open(ownerId, 'bug', 'Erro', 'Meu problema.')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.creates.length, 1);
  const old = await f.tickets.open(ownerId, 'bug', 'Outro', 'Outra descrição.');
  assert.equal(old.department, 'rp'); assert.equal(f.creates.length, 1);
});
test('falta de disco antes da reserva impede criar qualquer canal', async t => {
  const f = await fixture(t); f.store.transact = async () => { throw new Error('disk full'); };
  await assert.rejects(f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.'), /disk full/); assert.equal(f.creates.length, 0);
});
test('reserva recupera canal criado com resposta perdida após reinício sem duplicar', async t => {
  const f = await fixture(t); f.setUnknownCreate();
  await assert.rejects(f.tickets.open(ownerId, 'bug', 'Erro', 'Descrição.'));
  assert.equal(f.store.snapshot().tickets[0]!.status, 'creating');
  const reopened = new TicketStore(f.dir); await reopened.init();
  const service = new Tickets(f.client, guildId, reopened);
  const recovered = await service.open(ownerId, 'bug', 'Erro', 'Descrição.');
  assert.equal(recovered.status, 'open'); assert.equal(f.creates.length, 1);
});
test('resultado incerto sem canal encontrado mantém reserva e impede segundo POST', async t => {
  const f = await fixture(t); f.setFailBeforeCreate();
  await assert.rejects(f.tickets.open(ownerId, 'bug', 'Erro', 'Descrição.'));
  await assert.rejects(f.tickets.open(ownerId, 'bug', 'Erro', 'Descrição.'), /sem confirmação/); assert.equal(f.creates.length, 1);
});
test('somente equipe assume; perda do cargo e usuário de outro ticket são bloqueados', async t => {
  const f = await fixture(t); const ticket = await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.');
  await assert.rejects(f.tickets.claim(ticket.id, ticket.channelId!, ownerId), /restrita/);
  await assert.rejects(f.tickets.close(ticket.id, ticket.channelId!, outsiderId, 'Fechar'), /restrita/);
  await assert.rejects(f.tickets.getAuthorized(ticket.id, panelId, ownerId), /não encontrado/);
  await f.tickets.claim(ticket.id, ticket.channelId!, staffId); assert.equal(f.store.snapshot().tickets[0]!.claimedBy, staffId);
  f.members.get(staffId)!.roles.cache.clear();
  await assert.rejects(f.tickets.close(ticket.id, ticket.channelId!, staffId, 'Fechar'), /restrita/);
});
test('encerramento mantém histórico, bloqueia escrita e não herda a categoria de arquivo', async t => {
  const f = await fixture(t); const ticket = await f.tickets.open(ownerId, 'doacoes', 'Doação', 'Informações.');
  await f.tickets.close(ticket.id, ticket.channelId!, ownerId, 'Resolvido @everyone');
  const ch = f.channels.get(ticket.channelId!)!;
  assert.equal(ch.parentId, closedId);
  for (const who of [ownerId, staffId]) { assert.equal(ch.permissionsFor(f.members.get(who)).has(P.ViewChannel), true); assert.equal(ch.permissionsFor(f.members.get(who)).has(P.SendMessages), false); }
  assert.equal(ch.permissionsFor(f.members.get(outsiderId)).has(P.ViewChannel), false);
  assert.equal(f.store.snapshot().tickets[0]!.status, 'closed');
  assert.ok(f.sends.some(m => m.channelId === logId && m.body.content.includes(`<#${ticket.channelId}>`)));
  assert.equal(f.channels.has(ticket.channelId!), true);
  await assert.rejects(f.tickets.open(ownerId, 'doacoes', 'Outro', 'Descrição.'), /um minuto/);
});
test('falha nos logs mantém fechamento pendente e reinício conclui sem perder canal', async t => {
  const f = await fixture(t); const ticket = await f.tickets.open(ownerId, 'rp', 'Proposta', 'Descrição.'); f.setFailLog(true);
  await assert.rejects(f.tickets.close(ticket.id, ticket.channelId!, ownerId, 'Concluído'));
  assert.equal(f.store.snapshot().tickets[0]!.status, 'closing');
  f.setFailLog(false); const reopened = new TicketStore(f.dir); await reopened.init();
  await new Tickets(f.client, guildId, reopened).recover();
  assert.equal(reopened.snapshot().tickets[0]!.status, 'closed'); assert.equal(f.sends.filter(m => m.channelId === logId).length, 1);
});
test('categoria de arquivo cheia mantém ticket encerrado sem excluir ou abrir permissões', async t => {
  const f = await fixture(t); const ticket = await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.');
  for (let n = 0; n < 50; n++) f.channels.set(`dummy${n}`, { parentId: closedId });
  await f.tickets.close(ticket.id, ticket.channelId!, ownerId, 'Fim');
  assert.equal(f.store.snapshot().tickets[0]!.status, 'closed'); assert.equal(f.channels.get(ticket.channelId!)!.parentId, ticket.categoryId);
});
test('estado inválido não é sobrescrito e seed não apaga configuração após reiniciar', async t => {
  const f = await fixture(t); const reopened = new TicketStore(f.dir); await reopened.init(ticketDefaults()); assert.equal(reopened.snapshot().config.panelChannelId, panelId);
  assert.throws(() => ticketSeed('{invalid'), /TICKETS_CONFIG/);
  await writeFile(f.store.path, '{invalid'); await assert.rejects(new TicketStore(f.dir).init(), /não foi sobrescrito/); assert.equal(await readFile(f.store.path, 'utf8'), '{invalid');
});
test('impede @everyone como equipe e bots como atendentes', async t => {
  const f = await fixture(t);
  assert.throws(() => ticketOverwrites(guildId, botId, ownerId, [guildId]));
  assert.equal(ticketStaff(f.members.get(botId) as GuildMember, { roleIds: [roleId] }), false);
  await assert.rejects(f.tickets.open(botId, 'suporte', 'Bot', 'Descrição.'), /Bots não podem/);
  await f.store.transact(s => { s.config.routes.suporte.roleIds = [guildId]; });
  await assert.rejects(f.tickets.checkConfig(), /cargos próprios/);
});
test('fluxo de membro passa pelo roteador, exige painel atual e mantém respostas privadas', async t => {
  const f = await fixture(t); const panelMessageId = await f.tickets.ensurePanel();
  const replies: any[] = []; let mode = 'select';
  const i: any = { user: { id: ownerId }, guildId, guild: f.guild, channelId: panelId, message: { id: panelMessageId }, customId: 'ticket:select', values: ['suporte'],
    isChatInputCommand: () => false, isButton: () => false, isModalSubmit: () => mode === 'modal', isStringSelectMenu: () => mode === 'select', isRepliable: () => true,
    showModal: async (body: any) => { replies.push(body.toJSON()); }, deferReply: async (body: any) => { i.deferred = true; replies.push(body); }, editReply: async (body: any) => { replies.push(body); }, followUp: async (body: any) => { replies.push(body); }, reply: async (body: any) => { replies.push(body); }, fields: { getTextInputValue: (key: string) => key === 'subject' ? 'Ajuda' : 'Minha dúvida.' } };
  const ctx = { tickets: f.tickets, env: { guildId } } as Context;
  await onInteraction(i as Interaction, ctx); assert.match(replies[0].custom_id, /^ticket:open:suporte:/);
  i.customId = replies[0].custom_id; mode = 'modal'; await onInteraction(i as Interaction, ctx);
  assert.equal(replies[1].flags, 64); assert.match(replies[2], /Seu atendimento está em/); assert.equal(f.creates.length, 1);
  mode = 'select'; i.customId = 'ticket:select'; i.message.id = '133456789012345678'; await onInteraction(i as Interaction, ctx); assert.match(replies.at(-1).content, /não está mais ativo/);
});

test('ativação reutiliza quatro centrais e quatro canais privados de avisos', async t => {
  const f = await fixture(t); const panel = await f.tickets.ensurePanel();
  await f.tickets.enableThreads(); await f.tickets.enableThreads();
  assert.equal(f.creates.length, 8); assert.equal(f.store.snapshot().config.mode, 'thread');
  assert.equal(await f.tickets.ensurePanel(), panel);
  for (const d of departments) assert.equal(f.channels.get(f.store.snapshot().config.routes[d].parentChannelId!)!.topic, hubTopic(d));
});
test('tópicos privados preservam isolamento e fecham arquivados sem excluir ou mover canais', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const opened = await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Minha dúvida.');
  const thread = f.channels.get(opened.channelId!)!;
  assert.equal(thread.type, ChannelType.PrivateThread); assert.equal(thread.invitable, false); assert.equal(thread.memberIds.has(ownerId), true);
  assert.equal(thread.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), true);
  assert.equal(thread.permissionsFor(f.members.get(outsiderId)).has(P.ViewChannel), false);
  assert.equal(thread.permissionsFor(f.members.get(staffId)).has(P.ManageThreads), true);
  const parentId = thread.parentId;
  await f.tickets.claim(opened.id, thread.id, staffId); assert.equal(thread.memberIds.has(staffId), false);
  await f.tickets.close(opened.id, thread.id, ownerId, 'Resolvido.');
  assert.equal(thread.archived, true); assert.equal(thread.locked, true); assert.equal(thread.parentId, parentId);
  assert.equal(f.channels.has(thread.id), true); assert.equal(f.creates.length, 8); assert.equal(f.threadCreates.length, 1);
  assert.equal(f.store.snapshot().tickets[0]!.status, 'closed');
});
test('cargo de outro departamento e permissão global de tópicos não abrem tickets alheios', async t => {
  const f = await fixture(t); const foreign = '143456789012345678';
  f.members.get(outsiderId)!.permissions = new PermissionsBitField(P.ManageThreads);
  f.members.get(outsiderId)!.roles.cache.set(foreign, {});
  await f.tickets.enableThreads(); const opened = await f.tickets.open(ownerId, 'doacoes', 'Informações', 'Descrição.');
  const thread = f.channels.get(opened.channelId!)!;
  assert.equal(thread.permissionsFor(f.members.get(outsiderId)).has(P.ViewChannel), false);
  await assert.rejects(f.tickets.claim(opened.id, thread.id, outsiderId), /restrita/);
  const acl = hubOverwrites(guildId, botId, [roleId], f.store.snapshot().config.routes.doacoes.accessRoleId!);
  assert.ok(new PermissionsBitField(acl[0]!.deny).has(P.ManageThreads));
  assert.ok(new PermissionsBitField(acl[0]!.deny).has([P.CreatePrivateThreads, P.CreatePublicThreads]));
});
test('permissões adulteradas na central bloqueiam novas aberturas até correção', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const hub = f.channels.get(f.store.snapshot().config.routes.suporte.parentChannelId!)!;
  hub.permissionOverwrites.cache.set(outsiderId, { id: outsiderId, type: 1, allow: new PermissionsBitField(P.ManageThreads), deny: new PermissionsBitField(0n) });
  await assert.rejects(f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.'), /permissões da central/);
  assert.equal(f.threadCreates.length, 0);
  await f.tickets.enableThreads(); assert.equal((await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.')).kind, 'thread');
});
test('falha ao convidar mantém reserva; reinício retoma o mesmo tópico', async t => {
  const f = await fixture(t); await f.tickets.enableThreads(); f.setFailInvite(true);
  await assert.rejects(f.tickets.open(ownerId, 'rp', 'Proposta', 'Descrição.'));
  const pending = f.store.snapshot().tickets[0]!; assert.equal(pending.status, 'creating'); assert.ok(pending.channelId);
  const reopened = new TicketStore(f.dir); await reopened.init(); f.setFailInvite(false);
  const recovered = await new Tickets(f.client, guildId, reopened).open(ownerId, 'rp', 'Proposta', 'Descrição.');
  assert.equal(recovered.channelId, pending.channelId); assert.equal(f.threadCreates.length, 1);
});
test('criação incerta reencontra tópico privado arquivado sem duplicá-lo', async t => {
  const f = await fixture(t); await f.tickets.enableThreads(); f.setUnknownCreate();
  await assert.rejects(f.tickets.open(ownerId, 'bug', 'Erro', 'Descrição.'));
  const pending = f.store.snapshot().tickets[0]!;
  const thread = f.channels.find(c => c.type === ChannelType.PrivateThread)!; thread.archived = true;
  const parent = f.channels.get(pending.parentChannelId!)!;
  assert.equal((await findThread(parent, pending))!.id, thread.id); assert.equal(thread.name, threadName(pending));
  const reopened = new TicketStore(f.dir); await reopened.init();
  await new Tickets(f.client, guildId, reopened).recover();
  assert.equal(reopened.snapshot().tickets[0]!.status, 'open'); assert.equal(thread.archived, false); assert.equal(f.threadCreates.length, 1);
});
test('falha no registro deixa tópico bloqueado; recuperação conclui sem apagar histórico', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const opened = await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.'); f.setFailLog(true);
  await assert.rejects(f.tickets.close(opened.id, opened.channelId!, ownerId, 'Fim'));
  const thread = f.channels.get(opened.channelId!)!; assert.equal(thread.archived, true); assert.equal(thread.locked, true);
  assert.equal(f.store.snapshot().tickets[0]!.status, 'closing');
  f.setFailLog(false); await f.tickets.recover(); assert.equal(f.store.snapshot().tickets[0]!.status, 'closed');
  assert.equal(thread.archived, true); assert.equal(thread.locked, true); assert.equal(f.sends.filter(m => m.channelId === logId).length, 1);
});
test('tickets antigos continuam encerrando como canais após ativar tópicos', async t => {
  const f = await fixture(t); const old = await f.tickets.open(ownerId, 'suporte', 'Antigo', 'Descrição.');
  await f.tickets.enableThreads(); await f.tickets.close(old.id, old.channelId!, ownerId, 'Fim');
  assert.equal(f.channels.get(old.channelId!)!.type, ChannelType.GuildText); assert.equal(f.channels.get(old.channelId!)!.parentId, closedId);
  assert.equal(f.store.snapshot().tickets[0]!.status, 'closed');
});
test('/atendimentos exibe links em resposta privada só para equipe autorizada', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const ticket = await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.');
  const replies: any[] = [];
  const i: any = { guildId, guild: f.guild, channelId: panelId, user: { id: staffId }, commandName: 'atendimentos',
    isChatInputCommand: () => true, isButton: () => false, isModalSubmit: () => false, isStringSelectMenu: () => false, isRepliable: () => true,
    deferReply: async (body: any) => { i.deferred = true; replies.push(body); }, editReply: async (body: any) => { replies.push(body); }, followUp: async (body: any) => { replies.push(body); } };
  const ctx = { tickets: f.tickets, env: { guildId } } as Context;
  await onInteraction(i, ctx); assert.equal(replies[0].flags, 64); assert.ok(replies[1].content.includes(`<#${ticket.channelId}>`));
  i.user.id = outsiderId; await onInteraction(i, ctx); assert.match(replies.at(-1).content, /restrito à equipe/);
});

test('centrais ficam ocultas até abertura e só o setor escolhido é liberado', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const before = f.store.snapshot().config;
  for (const d of departments) assert.equal(f.channels.get(before.routes[d].parentChannelId!)!.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), false);
  await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.');
  for (const d of departments) assert.equal(f.channels.get(before.routes[d].parentChannelId!)!.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), d === 'suporte');
  const access = before.routes.suporte.accessRoleId!;
  assert.equal(f.members.get(ownerId)!.roles.cache.has(access), true);
  assert.equal(f.roles.get(access)!.permissions.bitfield, 0n);
  assert.equal(f.members.get(ownerId)!.roles.cache.has(roleId), false);
});
test('cargo de acesso compartilhado não permite ver o tópico de outro solicitante', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const first = await f.tickets.open(ownerId, 'suporte', 'Primeiro', 'Descrição.');
  const second = await f.tickets.open(outsiderId, 'suporte', 'Segundo', 'Descrição.');
  assert.equal(f.channels.get(first.channelId!)!.permissionsFor(f.members.get(outsiderId)).has(P.ViewChannel), false);
  assert.equal(f.channels.get(second.channelId!)!.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), false);
  await assert.rejects(f.tickets.claim(first.id, first.channelId!, outsiderId), /restrita/);
});
test('encerramento e reinício preservam acesso ao histórico sem liberar demais setores', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const opened = await f.tickets.open(ownerId, 'doacoes', 'Doação', 'Descrição.');
  await f.tickets.close(opened.id, opened.channelId!, ownerId, 'Fim');
  const access = f.store.snapshot().config.routes.doacoes.accessRoleId!;
  const rolesBefore = f.roles.size;
  const reopened = new TicketStore(f.dir); await reopened.init();
  await new Tickets(f.client, guildId, reopened).enableThreads();
  assert.equal(f.roles.size, rolesBefore); assert.equal(reopened.snapshot().config.routes.doacoes.accessRoleId, access);
  const thread = f.channels.get(opened.channelId!)!;
  assert.equal(thread.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), true);
  assert.equal(thread.archived, true); assert.equal(thread.locked, true);
  assert.equal(f.channels.get(reopened.snapshot().config.routes.bug.parentChannelId!)!.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), false);
});
test('falha ao atribuir cargo não cria tópico e reserva permite nova tentativa', async t => {
  const f = await fixture(t); await f.tickets.enableThreads(); f.setFailGrant(true);
  await assert.rejects(f.tickets.open(ownerId, 'rp', 'Proposta', 'Descrição.'), /Role grant/);
  assert.equal(f.threadCreates.length, 0); assert.equal(f.store.snapshot().tickets[0]!.creationAttempted, undefined);
  f.setFailGrant(false); const opened = await f.tickets.open(ownerId, 'rp', 'Proposta', 'Descrição.');
  assert.equal(opened.status, 'open'); assert.equal(f.threadCreates.length, 1);
});
test('migração preserva participantes de tópicos arquivados sem reabrir ou excluir', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const opened = await f.tickets.open(ownerId, 'suporte', 'Antigo', 'Descrição.');
  await f.tickets.close(opened.id, opened.channelId!, ownerId, 'Fim');
  const access = f.store.snapshot().config.routes.suporte.accessRoleId!;
  f.members.get(ownerId)!.roles.cache.delete(access);
  await f.store.transact(s => { delete s.config.routes.suporte.accessRoleId; });
  await f.tickets.enableThreads();
  assert.equal(f.members.get(ownerId)!.roles.cache.has(access), true);
  assert.equal(f.channels.get(opened.channelId!)!.archived, true);
  assert.equal(f.channels.get(opened.channelId!)!.locked, true);
});
test('cargo de acesso adulterado não concede permissões ao novo solicitante', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const access = f.store.snapshot().config.routes.bug.accessRoleId!;
  f.roles.get(access)!.permissions = new PermissionsBitField(P.Administrator);
  await assert.rejects(f.tickets.open(ownerId, 'bug', 'Erro', 'Descrição.'), /Cargo de acesso/);
  assert.equal(f.members.get(ownerId)!.roles.cache.has(access), false); assert.equal(f.threadCreates.length, 0);
});

test('abertura avisa só os cargos do setor em canal privado com link do ticket', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const ticket = await f.tickets.open(ownerId, 'suporte', '@everyone <@&123456789012345678>', 'Não pode gerar menções extras.');
  const route = f.store.snapshot().config.routes.suporte;
  const alerts = f.channels.get(route.notificationChannelId!)!;
  const notices = f.sends.filter(m => m.channelId === alerts.id);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].body.allowedMentions, { parse: [], roles: [roleId], users: [], repliedUser: false });
  assert.match(notices[0].body.content, new RegExp(ticket.channelId!));
  assert.doesNotMatch(notices[0].body.content, /@everyone|<@&123456789012345678>/);
  assert.equal(alerts.permissionsFor(f.members.get(ownerId)).has(P.ViewChannel), false);
  assert.equal(alerts.permissionsFor(f.members.get(staffId)).has(P.ViewChannel), true);
  assert.equal(f.store.snapshot().tickets[0]!.notificationStatus, 'sent');
});
test('novo pedido e reinício não repetem a notificação do mesmo ticket', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  await f.tickets.open(ownerId, 'suporte', 'Ajuda', 'Descrição.');
  await f.tickets.open(ownerId, 'bug', 'Outro assunto', 'Descrição.');
  const reopened = new TicketStore(f.dir); await reopened.init();
  await new Tickets(f.client, guildId, reopened).recover();
  assert.equal(f.sends.filter(m => m.body.nonce?.startsWith('open')).length, 1);
});
test('falha definitiva no aviso não impede ticket e recuperação tenta novamente', async t => {
  const f = await fixture(t); await f.tickets.enableThreads(); f.setNoticeFailure('before');
  const opened = await f.tickets.open(ownerId, 'bug', 'Erro', 'Descrição.');
  assert.equal(opened.status, 'open'); assert.equal(f.store.snapshot().tickets[0]!.notificationStatus, 'pending');
  f.setNoticeFailure(null); await f.tickets.recover();
  assert.equal(f.store.snapshot().tickets[0]!.notificationStatus, 'sent');
  assert.equal(f.sends.filter(m => m.body.nonce?.startsWith('open')).length, 1);
});
test('timeout após enviar o aviso é reconciliado sem nova menção', async t => {
  const f = await fixture(t); await f.tickets.enableThreads(); f.setNoticeFailure('after');
  await f.tickets.open(ownerId, 'rp', 'Proposta', 'Descrição.');
  assert.equal(f.store.snapshot().tickets[0]!.notificationStatus, 'sending');
  f.setNoticeFailure(null); const reopened = new TicketStore(f.dir); await reopened.init();
  await new Tickets(f.client, guildId, reopened).recover();
  assert.equal(reopened.snapshot().tickets[0]!.notificationStatus, 'sent');
  assert.equal(f.sends.filter(m => m.body.nonce?.startsWith('open')).length, 1);
});
test('permissão de avisos adulterada impede vazamento de abertura', async t => {
  const f = await fixture(t); await f.tickets.enableThreads();
  const alerts = f.channels.get(f.store.snapshot().config.routes.doacoes.notificationChannelId!)!;
  alerts.permissionOverwrites.cache.set(outsiderId, { id: outsiderId, type: 1, allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField(0n) });
  const opened = await f.tickets.open(ownerId, 'doacoes', 'Doação', 'Descrição.');
  assert.equal(opened.status, 'open'); assert.equal(f.store.snapshot().tickets[0]!.notificationStatus, 'pending');
  assert.equal(f.sends.filter(m => m.channelId === alerts.id).length, 0);
});
test('tickets antigos não geram avisos retroativos e reserva incerta não é reenviada', async t => {
  const f = await fixture(t); const old = await f.tickets.open(ownerId, 'suporte', 'Anterior', 'Descrição.');
  await f.tickets.enableThreads(); await f.tickets.recover();
  assert.equal(f.sends.filter(m => m.body.nonce?.startsWith('open')).length, 0);
  await f.tickets.close(old.id, old.channelId!, ownerId, 'Fim');
  const pending = await f.tickets.open(outsiderId, 'bug', 'Teste', 'Descrição.');
  await f.store.transact(s => { const t = s.tickets.find(t => t.id === pending.id)!; t.notificationStatus = 'sending'; delete t.notificationMessageId; });
  const alerts = f.channels.get(f.store.snapshot().config.routes.bug.notificationChannelId!)!;
  alerts.messages.fetch = async () => new Collection();
  const count = f.sends.length; await f.tickets.recover();
  assert.equal(f.sends.length, count); assert.equal(f.store.snapshot().tickets.find(t => t.id === pending.id)!.notificationStatus, 'sending');
});
