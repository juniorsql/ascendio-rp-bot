import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageFlags, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { defaults } from '../src/config/defaults.js';
import { loadEnv } from '../src/config/env.js';
import { color, fields, imageUrl, safeText, validateEmbeds, urlButtons } from '../src/validation/input.js';
import { postEmbed, rulesEmbeds, welcomeEmbed } from '../src/templates/embeds.js';
import { Store } from '../src/services/store.js';
import { Drafts, fingerprint, publicationOptions, publish, type Draft } from '../src/services/drafts.js';
import { authorized } from '../src/services/discord.js';
import { commands } from '../src/commands/definitions.js';
import { controls, postForm } from '../src/components/forms.js';
import { errorCode, log } from '../src/logs/logger.js';
import { publicationCard } from '../src/components/publication-card.js';
const guildId = '123456789012345678', ownerId = '223456789012345678', channelId = '323456789012345678';
const makeDraft = (drafts = new Drafts()): Draft => drafts.create({ guildId, ownerId, channelId, embeds: postEmbed({ kind: 'comunicado', title: 'Convocação', description: 'Encontro no salão principal.', image: '', thumbnail: '', fields: [] }, defaults()) });
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-test-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const store = new Store(dir); await store.init(); return { dir, store };
}
test('URLs aceitam HTTPS e rejeitam protocolos, IPs, credenciais e destinos locais', () => {
  assert.equal(imageUrl('https://cdn.discordapp.com/attachments/a/banner.png?size=1024'), 'https://cdn.discordapp.com/attachments/a/banner.png?size=1024');
  assert.equal(imageUrl(''), '');
  for (const url of ['http://example.com/a.png', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:pass@example.com/a', 'https://example.local/a', 'https://localhost/a', 'file:///etc/passwd', 'https://example.com:444/a', 'lixo']) assert.throws(() => imageUrl(url));
});
test('menções em texto são neutralizadas', () => {
  const value = safeText('@everyone @here <@123456789012345678> <@&123456789012345678>');
  assert.ok(!value.includes('@everyone')); assert.ok(!value.includes('@here')); assert.ok(!/<@&?\d/.test(value));
});

test('botões de URL validam nome, HTTPS público, limite de 5 e URL de até 512 caracteres', () => {
  assert.deepEqual(urlButtons('Discord | https://discord.gg/exemplo\nSite | https://example.com'), [
    { label: 'Discord', url: 'https://discord.gg/exemplo' }, { label: 'Site', url: 'https://example.com/' },
  ]);
  assert.deepEqual(urlButtons(' \n '), []);
  for (const value of ['Sem separador', '| https://example.com', 'A |', `${'A'.repeat(81)} | https://example.com`, 'A | https://user:secret@example.com', 'A | http://example.com', 'A | javascript:alert(1)', 'A | https://localhost', 'A | https://127.0.0.1', `A | https://example.com/${'x'.repeat(500)}`, Array(6).fill('A | https://example.com').join('\n')]) assert.throws(() => urlButtons(value));
  assert.equal(urlButtons(Array(5).fill('A | https://example.com').join('\n')).length, 5);
});

test('botões entram na deduplicação e no payload público como links sem comandos administrativos', () => {
  const a = makeDraft(), b = makeDraft();
  assert.equal(fingerprint(a), fingerprint(b));
  a.links = urlButtons('Discord | https://discord.gg/exemplo');
  assert.notEqual(fingerprint(a), fingerprint(b));
  b.links = urlButtons('Discord | https://discord.gg/exemplo');
  assert.equal(fingerprint(a), fingerprint(b));
  b.links[0]!.url = 'https://discord.gg/outro'; assert.notEqual(fingerprint(a), fingerprint(b));
  const payload = publicationOptions(a, 'synthetic-nonce');
  const row = (payload.components![0] as { toJSON(): any }).toJSON();
  assert.deepEqual(row.components.map((c: any) => ({ style: c.style, label: c.label, url: c.url, customId: c.custom_id })), [{ style: 5, label: 'Discord', url: 'https://discord.gg/exemplo', customId: undefined }]);
  assert.deepEqual(payload.allowedMentions?.parse, []);
});

test('card com banner renderiza imagem, título, separador e corpo nessa ordem, preservando miniatura e campos', () => {
  const embed = { title: 'Convite', description: 'Nossa comunidade.', color: 0xb49a61, image: { url: 'https://example.com/banner.png' }, thumbnail: { url: 'https://example.com/logo.png' }, fields: [{ name: 'Acesso', value: 'Antecipado' }] };
  const card = publicationCard([embed], 'top').toJSON();
  assert.equal(card.type, 17); assert.equal(card.accent_color, embed.color);
  assert.deepEqual(card.components.map(c => c.type), [12,9,14,10]);
  const data = card as any;
  assert.equal(data.components[0].items[0].media.url, embed.image.url);
  assert.equal(data.components[1].components[0].content, '## Convite');
  assert.equal(data.components[1].accessory.media.url, embed.thumbnail.url);
  assert.match(data.components[3].content, /\*\*Acesso\*\*\nAntecipado/);
  assert.equal(publicationCard([embed], 'bottom').toJSON().components.at(-1)!.type, 12);
});

test('publicação com imagem no topo usa somente componentes e menção coletiva exige ativação explícita', () => {
  const post = { kind: 'comunicado' as const, title: 'Convite', description: 'Olá @everyone.', image: 'https://example.com/banner.png', thumbnail: '', fields: [], imagePosition: 'top' as const };
  const d = new Drafts().create({ guildId, ownerId, channelId, post, embeds: postEmbed(post, defaults()), links: [{ label: 'Discord', url: 'https://discord.gg/exemplo' }] });
  const payload = publicationOptions(d, 'banner-nonce');
  assert.equal(payload.flags, MessageFlags.IsComponentsV2); assert.equal(payload.content, undefined); assert.equal(payload.embeds, undefined);
  assert.deepEqual(payload.allowedMentions?.parse, []);
  assert.equal((payload.components![0] as { toJSON(): any }).toJSON().type, 17);
  assert.equal((payload.components!.at(-1) as { toJSON(): any }).toJSON().components[0].style, 5);
  d.notifyEveryone = true;
  const notified = publicationOptions(d, 'banner-nonce-2');
  assert.equal((notified.components![0] as { toJSON(): any }).toJSON().content, '@everyone');
  assert.deepEqual(notified.allowedMentions?.parse, ['everyone']);
});

test('posição da imagem faz parte da deduplicação e ativar everyone não muda a chave', () => {
  const a = makeDraft(), b = makeDraft();
  a.layoutV2 = true; a.post = { kind: 'comunicado', title: 'Convocação', description: 'Encontro.', image: '', thumbnail: '', fields: [], imagePosition: 'top' };
  assert.notEqual(fingerprint(a), fingerprint(b));
  const top = fingerprint(a); a.notifyEveryone = true; assert.equal(fingerprint(a), top);
  a.post.imagePosition = 'bottom'; assert.notEqual(fingerprint(a), top);
});

test('card respeita orçamento de texto antes de reservar ou enviar, sem truncar conteúdo', async t => {
  const { store } = await fixture(t), d = makeDraft();
  d.layoutV2 = true; d.embeds = [{ title: 'Título', description: 'a'.repeat(4000) }];
  let sends = 0;
  await assert.rejects(publish(d, store, async () => { sends++; return { id: ownerId }; }), /4000/);
  assert.equal(sends, 0); assert.equal(d.busy, false); assert.equal(store.snapshot().receipts.length, 0);
  assert.throws(() => publicationCard([{ title: 'Teste', description: 'a'.repeat(3700) }], 'top', 'p'.repeat(400)), /4000/);
});
test('campos e cores validam formato e limites', () => {
  assert.equal(color('#B49A61'), 0xb49a61); assert.throws(() => color('red'));
  assert.deepEqual(fields('Local | Grande salão | sim'), [{ name: 'Local', value: 'Grande salão', inline: true }]);
  assert.throws(() => fields('incompleto')); assert.throws(() => fields('Nome | valor | talvez'));
  assert.throws(() => fields(Array(11).fill('N | V').join('\n')));
});
test('limites individuais e agregados dos embeds são aplicados', () => {
  assert.throws(() => validateEmbeds([{ title: 'a'.repeat(257) }]));
  assert.throws(() => validateEmbeds([{ description: 'a'.repeat(4097) }]));
  assert.throws(() => validateEmbeds([{ description: 'a'.repeat(4000) }, { description: 'b'.repeat(2001) }]));
  assert.throws(() => validateEmbeds(Array(11).fill({ title: 'A' })));
  assert.doesNotThrow(() => validateEmbeds([{ description: 'a'.repeat(4000) }, { description: 'b'.repeat(2000) }]));
});
test('templates compartilham identidade e regras são demonstrativas por padrão', () => {
  const config = defaults(); assert.equal(rulesEmbeds(config).length, 8);
  for (const embed of rulesEmbeds(config)) assert.match(embed.description!, /DEMONSTRAÇÃO — NÃO OFICIAL/);
  config.rules[0]!.official = true; config.rules[0]!.content = 'Texto aprovado pela equipe.';
  assert.doesNotMatch(rulesEmbeds(config)[0]!.description!, /DEMONSTRAÇÃO/);
  config.welcomeText = 'Olá {membro}, {servidor}: {regras}. @everyone'; config.rulesChannelId = channelId;
  const welcome = welcomeEmbed(config, ownerId)[0]!;
  assert.ok(welcome.description!.includes(`<@${ownerId}>`)); assert.ok(welcome.description!.includes(`<#${channelId}>`));
  assert.ok(!welcome.description!.includes('@everyone')); assert.ok(!welcome.description!.includes('{servidor}'));
});
test('ambiente obrigatório falha sem revelar o token', () => {
  assert.throws(() => loadEnv({}), /DISCORD_TOKEN/);
  assert.throws(() => loadEnv({ DISCORD_TOKEN: 'x'.repeat(60), DISCORD_CLIENT_ID: 'inválido' }), /DISCORD_CLIENT_ID/);
  const env = loadEnv({ DISCORD_TOKEN: 'x'.repeat(60), DISCORD_CLIENT_ID: ownerId, DISCORD_GUILD_ID: guildId, REGISTER_COMMANDS_ON_START: 'false' });
  assert.equal(env.register, false); assert.equal(env.guildId, guildId);
});
test('usuário comum é bloqueado, cargos publicam e configuração exige Gerenciar servidor', () => {
  const config = defaults(); config.adminRoleIds = [ownerId];
  const member = (bits: bigint, hasRole = false) => ({ permissions: new PermissionsBitField(bits), roles: { cache: new Map(hasRole ? [[ownerId, {}]] : []) } }) as Parameters<typeof authorized>[0];
  assert.equal(authorized(member(0n), config), false);
  assert.equal(authorized(member(0n, true), config), true);
  assert.equal(authorized(member(0n, true), config, true), false);
  assert.equal(authorized(member(PermissionFlagsBits.ManageMessages), config), true);
  assert.equal(authorized(member(PermissionFlagsBits.ManageGuild), config, true), true);
});
test('comandos e componentes serializam sem credenciais e respeitam o escopo de servidor', () => {
  assert.equal(commands.length, 9); assert.equal(new Set(commands.map(c => c.name)).size, 9);
  const d = makeDraft(); assert.ok(controls(d)[0]!.toJSON().components.length >= 2);
  assert.equal(postForm('post:new:comunicado:123456789012345678').toJSON().components.length, 5);
  const composed = { ...d, post: { kind: 'comunicado' as const, title: 'Teste', description: 'Texto', image: '', thumbnail: '', fields: [] }, links: urlButtons('Site | https://example.com') };
  assert.equal(controls(composed).length, 5);
  assert.ok(controls(composed).every(row => row.toJSON().components.length <= 5));
  for (const c of commands) { assert.deepEqual(c.contexts, [0]); if (!['ajuda', 'atendimentos'].includes(c.name)) assert.ok(c.default_member_permissions); }
});

test('separador final aparece antes do encerramento personalizado e não inclui assinatura automática', () => {
  const embed = { title: 'Bem-vindos', description: 'Conteúdo principal.', image: { url: 'https://example.com/banner.png' } };
  const card = publicationCard([embed], 'top', '', '✨ Nosso próximo capítulo. @everyone').toJSON() as any;
  assert.deepEqual(card.components.map((c: any) => c.type), [12,10,14,10,14,10]);
  assert.equal(card.components[4].divider, true);
  assert.match(card.components[5].content, /Nosso próximo capítulo/);
  assert.ok(!card.components[5].content.includes('@everyone'));
  assert.equal(publicationCard([embed], 'top').toJSON().components.length, 4);
  assert.equal(publicationCard([embed], 'bottom', '', 'Final.').toJSON().components.at(-1)!.type, 12);
  assert.throws(() => publicationCard([embed], 'top', '', 'a'.repeat(1501)), /1500/);
});

test('texto final faz parte da deduplicação e respeita o orçamento de texto do card', () => {
  const a = makeDraft();
  a.layoutV2 = true; a.post = { kind: 'comunicado', title: 'Bem-vindos', description: 'Corpo', image: '', thumbnail: '', fields: [], closingText: 'Final A' };
  const b = { ...a, post: { ...a.post, closingText: 'Final B' } };
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.throws(() => publicationCard([{ title: 'Teste', description: 'a'.repeat(3000) }], 'top', '', 'b'.repeat(1100)), /4000/);
});
test('rascunhos validam titularidade, expiração, concorrência e limite por autor', () => {
  let now = 0; const drafts = new Drafts(() => now); const d = makeDraft(drafts);
  assert.throws(() => drafts.get(d.id, 'outro', guildId), /outro administrador/);
  d.busy = true; assert.throws(() => drafts.get(d.id, ownerId, guildId), /processada/); d.busy = false;
  for (let i = 0; i < 4; i++) makeDraft(drafts);
  assert.throws(() => makeDraft(drafts), /Limite/);
  now = 900_001; assert.throws(() => drafts.get(d.id, ownerId, guildId), /expirada/);
  assert.ok(makeDraft(drafts));
});
test('armazenamento serializa alterações, sobrevive à reabertura e limita auditoria', async t => {
  const { dir, store } = await fixture(t);
  await Promise.all(Array.from({ length: 20 }, (_, n) => store.transact(s => { s.audit.push({ time: n, action: 'test', userId: ownerId }); })));
  assert.equal(store.snapshot().audit.length, 20);
  const reopened = new Store(dir); await reopened.init(); assert.equal(reopened.snapshot().audit.length, 20);
  const copy = store.snapshot(); copy.config.name = 'Mutação externa'; assert.equal(store.snapshot().config.name, 'Ascendio RP');
  await store.transact(s => { s.audit.push(...Array.from({ length: 1100 }, () => ({ time: 1, action: 'test', userId: ownerId }))); });
  assert.equal(store.snapshot().audit.length, 1000);
});
test('estado corrompido não é silenciosamente substituído', async t => {
  const { dir, store } = await fixture(t); await writeFile(store.path, '{inválido');
  await assert.rejects(new Store(dir).init(), /não foi sobrescrito/);
  assert.equal(await readFile(store.path, 'utf8'), '{inválido');
});
test('alteração inválida não é persistida e fila se recupera', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.transact(s => { s.config.templates.evento.color = -1; }));
  assert.ok(store.snapshot().config.templates.evento.color >= 0);
  await store.transact(s => { s.config.name = 'Ascendio'; }); assert.equal(store.snapshot().config.name, 'Ascendio');
});
test('duplo clique e rascunhos idênticos resultam em um único envio', async t => {
  const { store } = await fixture(t); const a = makeDraft(), b = makeDraft(); let sends = 0;
  const send = async (_: unknown, nonce: string) => { assert.ok(nonce.length <= 25); sends++; return { id: ownerId }; };
  const result = await Promise.allSettled([publish(a, store, send), publish(a, store, send), publish(b, store, send)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(sends, 1);
  assert.equal(store.snapshot().receipts[0]!.status, 'sent'); assert.equal(store.snapshot().receipts[0]!.messageId, ownerId);
});
test('deduplicação ignora a data e inclui o canal', () => {
  const a = makeDraft(), b = makeDraft(); b.embeds[0]!.timestamp = '2020-01-01T00:00:00.000Z';
  assert.equal(fingerprint(a), fingerprint(b)); b.notifyEveryone = true; assert.equal(fingerprint(a), fingerprint(b));
  b.channelId = ownerId; assert.notEqual(fingerprint(a), fingerprint(b));
});
test('falha de rede mantém reserva através de reinício e bloqueia nova tentativa', async t => {
  const { dir, store } = await fixture(t);
  await assert.rejects(publish(makeDraft(), store, async () => { throw new Error('erro com possível segredo'); }), /reserva foi mantida/);
  const reopened = new Store(dir); await reopened.init(); let sent = false;
  await assert.rejects(publish(makeDraft(), reopened, async () => { sent = true; return { id: ownerId }; }), /duplicada/);
  assert.equal(sent, false); assert.equal(reopened.snapshot().receipts[0]!.status, 'sending');
});
test('falha de persistência anterior ao envio impede publicação', async t => {
  const { store } = await fixture(t); let sends = 0;
  store.transact = async () => { throw new Error('disco cheio'); };
  await assert.rejects(publish(makeDraft(), store, async () => { sends++; return { id: ownerId }; }), /disco cheio/);
  assert.equal(sends, 0);
});
test('logger não serializa detalhes de erro ou payload REST', () => {
  const captured: string[] = []; const original = console.log;
  console.log = (s: string) => captured.push(s);
  try { log('test', { code: errorCode({ code: 50013, requestBody: { token: 'segredo' } }) }); }
  finally { console.log = original; }
  assert.ok(!captured.join().includes('segredo')); assert.equal(JSON.parse(captured[0]!).code, '50013');
});
