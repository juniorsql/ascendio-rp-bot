import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType, MessageFlags, PermissionFlagsBits, PermissionsBitField, type Interaction, type GuildMember } from 'discord.js';
import { onInteraction, type Context } from '../src/commands/handler.js';
import { onMemberAdd } from '../src/events/welcome.js';
import { Drafts } from '../src/services/drafts.js';
import { Store } from '../src/services/store.js';
import { postEmbed } from '../src/templates/embeds.js';
const guildId = '123456789012345678', userId = '223456789012345678', channelId = '323456789012345678';
type Kind = 'command' | 'button' | 'modal' | 'select';
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-integration-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const sent: any[] = [], replies: any[] = [];
  let bits = PermissionFlagsBits.ManageMessages;
  const member = { id: userId, permissions: new PermissionsBitField(bits), roles: { cache: new Map() } };
  const guild = { id: guildId, members: { me: { id: 'bot' }, fetch: async () => { member.permissions = new PermissionsBitField(bits); return member; } } };
  const channel = { id: channelId, type: ChannelType.GuildText, guildId, guild, permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.Administrator), send: async (body: any) => { sent.push(body); return { id: '423456789012345678' }; } };
  const ctx = { store, drafts: new Drafts(), env: { guildId }, client: { channels: { fetch: async () => channel } } } as unknown as Context;
  const interaction = (kind: Kind, options: Record<string, any> = {}): Interaction => {
    const i: any = { user: { id: userId }, guildId, guild, replied: false, deferred: false,
      isChatInputCommand: () => kind === 'command', isButton: () => kind === 'button', isModalSubmit: () => kind === 'modal', isStringSelectMenu: () => kind === 'select', isRepliable: () => true, isFromMessage: () => false,
      reply: async (body: any) => { i.replied = true; replies.push(body); },
      editReply: async (body: any) => { replies.push(body); },
      followUp: async (body: any) => { replies.push(body); },
      deferReply: async (body: any) => { i.deferred = true; replies.push(body); },
      deferUpdate: async () => { i.deferred = true; },
      showModal: async (modal: any) => { replies.push(modal.toJSON()); },
      options: { getChannel: () => ({ id: channelId }), getString: () => 'comunicado' }, ...options,
    }; return i;
  };
  return { ctx, sent, replies, interaction, member, channel, setPermissions: (b: bigint) => { bits = b; } };
}
test('fluxo /anuncio → modal → prévia privada → confirmação envia embed uma vez', async t => {
  const f = await setup(t);
  await onInteraction(f.interaction('command', { commandName: 'anuncio' }), f.ctx);
  assert.match(f.replies[0].custom_id, /^post:new:comunicado:/); assert.equal(f.sent.length, 0);
  const input: Record<string, string> = { title: 'Convocação acadêmica', description: 'Encontro amanhã. @everyone', image: '', thumbnail: '', fields: 'Local | Salão principal | sim' };
  await onInteraction(f.interaction('modal', { customId: f.replies[0].custom_id, fields: { getTextInputValue: (key: string) => input[key] } }), f.ctx);
  assert.equal(f.replies[1].flags, MessageFlags.Ephemeral);
  const preview = f.replies[2]; assert.equal(f.sent.length, 0); assert.match(preview.content, /PRÉVIA PRIVADA/);
  const customId = preview.components[0].toJSON().components[0].custom_id;
  await onInteraction(f.interaction('button', { customId }), f.ctx);
  assert.equal(f.sent.length, 1); assert.deepEqual(f.sent[0].allowedMentions.parse, []); assert.equal(f.sent[0].enforceNonce, true);
  assert.ok(!f.sent[0].embeds[0].description.includes('@everyone')); assert.equal(f.ctx.store.snapshot().receipts[0]!.status, 'sent');
  await onInteraction(f.interaction('button', { customId }), f.ctx); assert.equal(f.sent.length, 1);
});
test('usuário comum não abre modal e perda de permissão antes de confirmar bloqueia envio', async t => {
  const f = await setup(t); f.setPermissions(0n);
  await onInteraction(f.interaction('command', { commandName: 'evento' }), f.ctx);
  assert.match(f.replies[0].content, /Acesso restrito/); assert.equal(f.replies[0].flags, MessageFlags.Ephemeral);
  const d = f.ctx.drafts.create({ guildId, ownerId: userId, channelId, embeds: [{ title: 'Teste' }] });
  await onInteraction(f.interaction('button', { customId: `confirm:${d.id}` }), f.ctx);
  assert.equal(f.sent.length, 0); assert.equal(f.ctx.store.snapshot().receipts.length, 0);
});
test('cancelamento remove a prévia sem publicar', async t => {
  const f = await setup(t); const d = f.ctx.drafts.create({ guildId, ownerId: userId, channelId, embeds: [{ title: 'Teste' }] });
  await onInteraction(f.interaction('button', { customId: `cancel:${d.id}` }), f.ctx);
  assert.equal(f.sent.length, 0); assert.match(f.replies[0].content, /cancelada/);
  assert.throws(() => f.ctx.drafts.get(d.id, userId, guildId));
});
test('seleção de cor atualiza prévia e edição abre formulário com conteúdo existente', async t => {
  const f = await setup(t); const post = { kind: 'evento' as const, title: 'Cerimônia', description: 'Conteúdo aprovado.', image: '', thumbnail: '', fields: [] };
  const d = f.ctx.drafts.create({ guildId, ownerId: userId, channelId, post, embeds: postEmbed(post, f.ctx.store.snapshot().config) });
  await onInteraction(f.interaction('select', { customId: `theme:${d.id}`, values: [String(0x202f4b)] }), f.ctx);
  assert.equal(d.embeds[0]!.color, 0x202f4b); assert.equal(f.sent.length, 0);
  await onInteraction(f.interaction('button', { customId: `edit:${d.id}` }), f.ctx);
  assert.equal(f.replies[1].components[0].components[0].value, 'Cerimônia');
});
test('URL inválida no formulário não cria publicação', async t => {
  const f = await setup(t); const input: Record<string, string> = { title: 'Título', description: 'Conteúdo', image: 'http://localhost/a.png', thumbnail: '', fields: '' };
  await onInteraction(f.interaction('modal', { customId: `post:new:comunicado:${channelId}`, fields: { getTextInputValue: (key: string) => input[key] } }), f.ctx);
  assert.match(f.replies.at(-1).content, /HTTPS/); assert.equal(f.sent.length, 0);
});
test('boas-vindas menciona somente o novo membro e ignora bots/outros servidores', async t => {
  const f = await setup(t); await f.ctx.store.transact(s => { s.config.welcomeChannelId = channelId; });
  const member = { id: userId, user: { bot: false }, guild: { id: guildId } } as GuildMember;
  await onMemberAdd(member, f.ctx);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].content, `<@${userId}>`); assert.deepEqual(f.sent[0].allowedMentions, { parse: [], users: [userId] });
  await onMemberAdd({ ...member, user: { bot: true } } as GuildMember, f.ctx);
  await onMemberAdd({ ...member, guild: { id: 'outro' } } as GuildMember, f.ctx); assert.equal(f.sent.length, 1);
});
test('canal sem permissões do bot não recebe publicação', async t => {
  const f = await setup(t); f.channel.permissionsFor = () => new PermissionsBitField(0n);
  const d = f.ctx.drafts.create({ guildId, ownerId: userId, channelId, embeds: [{ title: 'Teste' }] });
  await onInteraction(f.interaction('button', { customId: `confirm:${d.id}` }), f.ctx);
  assert.match(f.replies[0].content, /O bot precisa/); assert.equal(f.sent.length, 0); assert.equal(d.busy, false);
});
test('confirmação em andamento impede cancelamento concorrente', async t => {
  const f = await setup(t); const d = f.ctx.drafts.create({ guildId, ownerId: userId, channelId, embeds: [{ title: 'Teste' }] });
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const confirm = f.interaction('button', { customId: `confirm:${d.id}`, deferUpdate: async () => { entered(); await barrier; } });
  const pending = onInteraction(confirm, f.ctx); await enteredPromise;
  await onInteraction(f.interaction('button', { customId: `cancel:${d.id}` }), f.ctx);
  assert.match(f.replies[0].content, /processada/); release(); await pending; assert.equal(f.sent.length, 1);
});
test('configuração por formulário persiste identidade e regra aprovada', async t => {
  const f = await setup(t); f.setPermissions(PermissionFlagsBits.ManageGuild);
  const identity: Record<string, string> = { name: 'Ascendio RP', footer: 'Tradição e novas histórias.', logo: 'https://example.com/brasao.png' };
  await onInteraction(f.interaction('modal', { customId: 'cfg:identity', fields: { getTextInputValue: (key: string) => identity[key] } }), f.ctx);
  assert.equal(f.ctx.store.snapshot().config.footer, identity.footer);
  const rule: Record<string, string> = { title: 'Regras gerais', body: 'Texto oficial fornecido pela administração.', official: 'sim' };
  await onInteraction(f.interaction('modal', { customId: 'cfg:rule:0', fields: { getTextInputValue: (key: string) => rule[key] } }), f.ctx);
  assert.equal(f.ctx.store.snapshot().config.rules[0]!.official, true);
  const reopened = new Store(f.ctx.store.dir); await reopened.init(); assert.equal(reopened.snapshot().config.rules[0]!.content, rule.body);
  assert.equal(f.sent.length, 0);
});
test('configuração que excederia os limites na recepção é rejeitada antes de salvar', async t => {
  const f = await setup(t); f.setPermissions(PermissionFlagsBits.ManageGuild);
  const original = f.ctx.store.snapshot().config.welcomeText;
  const values: Record<string, string> = { title: 'Bem-vindo', body: '{membro}'.repeat(300) };
  await onInteraction(f.interaction('modal', { customId: 'cfg:welcome', fields: { getTextInputValue: (key: string) => values[key] } }), f.ctx);
  assert.match(f.replies.at(-1).content, /4096/); assert.equal(f.ctx.store.snapshot().config.welcomeText, original);
});
test('publicação de regras exige confirmação e preserva aviso de demonstração', async t => {
  const f = await setup(t);
  await onInteraction(f.interaction('command', { commandName: 'regras' }), f.ctx);
  const preview = f.replies[1]; assert.equal(preview.embeds.length, 8); assert.equal(f.sent.length, 0);
  const customId = preview.components[0].toJSON().components[0].custom_id;
  await onInteraction(f.interaction('button', { customId }), f.ctx);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].embeds.length, 8);
  for (const embed of f.sent[0].embeds) assert.match(embed.description, /NÃO OFICIAL/);
});
