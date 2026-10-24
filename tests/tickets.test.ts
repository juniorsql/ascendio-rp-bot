import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType, Collection, PermissionFlagsBits as P, PermissionsBitField, type Client, type GuildMember, type Interaction } from 'discord.js';
import { departments, TicketStore, ticketDefaults, ticketSeed } from '../src/tickets/store.js';
import { Tickets, ticketOverwrites, ticketPanel, ticketStaff } from '../src/tickets/service.js';
import { onInteraction, type Context } from '../src/commands/handler.js';

const guildId = '123456789012345678', botId = '223456789012345678', ownerId = '323456789012345678', staffId = '423456789012345678', outsiderId = '523456789012345678';
const panelId = '623456789012345678', logId = '723456789012345678', closedId = '823456789012345678', roleId = '923456789012345678';
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-tickets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const config = ticketDefaults(); Object.assign(config, { panelChannelId: panelId, logChannelId: logId, closedCategoryId: closedId });
  for (const [n, d] of departments.entries()) config.routes[d] = { categoryId: `13345678901234567${n}`, roleIds: [roleId] };
  const store = new TicketStore(dir); await store.init(config);
  let sequence = 0;
  const id = () => String(153456789012345670n + BigInt(++sequence));
  const all = new PermissionsBitField([P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.ManageChannels, P.ManageRoles]);
  const members = new Map<string, any>([ownerId, staffId, outsiderId, botId].map(userId => [userId, { id: userId, user: { bot: userId === botId }, permissions: userId === botId ? all : new PermissionsBitField(0n), roles: { cache: new Map(userId === staffId ? [[roleId, {}]] : []) } }]));
  const everyone = { id: guildId, name: '@everyone', managed: false };
  const roles = new Map([[guildId, everyone], [roleId, { id: roleId, name: 'Suporte', managed: false }]]);
  const channels = new Collection<string, any>();
  const creates: any[] = [], edits: any[] = [], sends: any[] = [];
  let unknownCreate = false, failLog = false, failBeforeCreate = false;
  function channel(channelId: string, type: ChannelType, overrides: any[] = []) {
    const messages = new Collection<string, any>();
    const ch: any = { id: channelId, guildId, type, topic: '', parentId: null, overrides,
      permissionsFor: (who: any) => {
        if (who.id === botId) return all;
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
        if (channelId === logId && failLog) throw new Error('Log temporarily unavailable');
        sends.push({ channelId, body });
        const m: any = { id: id(), author: { id: botId }, content: body.content ?? '', components: body.components ?? [], edit: async (body: any) => { m.content = body.content ?? ''; m.components = body.components ?? []; edits.push(body); return m; } };
        // Real discord.js messages expose parsed components with customId.
        const normalized = () => { m.components = m.components.map((row: any) => { const json = row.toJSON ? row.toJSON() : row; return { components: json.components.map((c: any) => ({ customId: c.custom_id })) }; }); };
        const edit = m.edit; m.edit = async (body: any) => { await edit(body); normalized(); return m; }; normalized();
        messages.set(m.id, m); return m;
      },
      edit: async (body: any) => { if (body.permissionOverwrites) ch.overrides = body.permissionOverwrites; Object.assign(ch, { name: body.name ?? ch.name }); edits.push(body); return ch; },
      setParent: async (parent: string, options: any) => { assert.equal(options.lockPermissions, false); ch.parentId = parent; return ch; },
    };
    channels.set(channelId, ch); return ch;
  }
  channel(panelId, ChannelType.GuildText); channel(logId, ChannelType.GuildText); channel(closedId, ChannelType.GuildCategory);
  for (const d of departments) channel(config.routes[d].categoryId, ChannelType.GuildCategory);
  const guild: any = { id: guildId, roles: { everyone, fetch: async (id: string) => roles.get(id) }, members: { fetch: async ({ user }: { user: string }) => members.get(user), fetchMe: async () => members.get(botId) }, channels: { fetch: async (id?: string) => id ? channels.get(id) : channels, create: async (body: any) => {
    creates.push(body); if (failBeforeCreate) throw new Error('Timed out before confirmation');
    const ch = channel(id(), body.type, body.permissionOverwrites); Object.assign(ch, { name: body.name, topic: body.topic, parentId: body.parent });
    if (unknownCreate) { unknownCreate = false; throw new Error('Timed out after channel creation'); } return ch;
  } } };
  const client = { user: { id: botId }, guilds: { fetch: async () => guild }, channels: { fetch: async (id: string) => { if (!channels.has(id)) throw Object.assign(new Error('Unknown channel'), { code: 10003 }); return channels.get(id); } } } as unknown as Client;
  const tickets = new Tickets(client, guildId, store);
  return { dir, config, store, tickets, client, guild, members, channels, creates, sends, edits, setUnknownCreate: () => { unknownCreate = true; }, setFailBeforeCreate: () => { failBeforeCreate = true; }, setFailLog: (value: boolean) => { failLog = value; } };
}

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
