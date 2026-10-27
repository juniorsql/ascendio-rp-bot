import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { defaults } from '../src/config/defaults.js';
import { loadEnv } from '../src/config/env.js';
import { color, fields, imageUrl, safeText, validateEmbeds } from '../src/validation/input.js';
import { postEmbed, rulesEmbeds, welcomeEmbed } from '../src/templates/embeds.js';
import { Store } from '../src/services/store.js';
import { Drafts, fingerprint, publish, type Draft } from '../src/services/drafts.js';
import { authorized } from '../src/services/discord.js';
import { commands } from '../src/commands/definitions.js';
import { controls, postForm } from '../src/components/forms.js';
import { errorCode, log } from '../src/logs/logger.js';
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
  for (const c of commands) { assert.deepEqual(c.contexts, [0]); if (!['ajuda', 'atendimentos'].includes(c.name)) assert.ok(c.default_member_permissions); }
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
