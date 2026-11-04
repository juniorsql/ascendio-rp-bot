import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField, type GuildMember } from 'discord.js';
import type { Context } from '../src/commands/handler.js';
import { defaults } from '../src/config/defaults.js';
import { loadEnv } from '../src/config/env.js';
import { onMemberAdd } from '../src/events/welcome.js';
import { onMemberScreened, recoverJoinRoles } from '../src/events/member-role.js';

const guildId = '123456789012345678', userId = '223456789012345678', roleId = '323456789012345678', otherRoleId = '423456789012345678', channelId = '523456789012345678';
function fixture() {
  const actions: string[] = [];
  const role = { id: roleId, managed: false };
  let permission = true, position = 1, missing = false, failAdd = false;
  const me = { permissions: { has: (bit: bigint) => bit === PermissionFlagsBits.ManageRoles && permission }, roles: { highest: { comparePositionTo: () => position } } };
  const guild = { id: guildId, roles: { fetch: async (_id: string, options: { force: boolean }) => { assert.equal(options.force, true); return missing ? null : role; } }, members: { fetchMe: async (options: { force: boolean }) => { assert.equal(options.force, true); return me; } } };
  const held = new Map([[otherRoleId, {}]]);
  const member = { id: userId, user: { bot: false }, guild, roles: { cache: held, add: async (id: string) => { assert.equal(id, roleId); if (failAdd) throw new Error('Network failure'); actions.push('role'); held.set(id, {}); } } } as unknown as GuildMember;
  const config = defaults();
  const channel = { id: channelId, type: ChannelType.GuildText, guildId, guild: { members: { me } }, permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.Administrator), send: async () => { actions.push('welcome'); return { id: '623456789012345678' }; } };
  const ctx = { env: { guildId, joinRoleId: roleId }, store: { snapshot: () => ({ config }) }, client: { guilds: { fetch: async () => guild }, channels: { fetch: async () => channel } } } as unknown as Context;
  return { member, config, ctx, role, held, actions, setPermission: (v: boolean) => { permission = v; }, setPosition: (v: number) => { position = v; }, setMissing: () => { missing = true; }, setFailAdd: () => { failAdd = true; } };
}
test('novo membro recebe o cargo configurado antes das boas-vindas sem perder os outros', async () => {
  const f = fixture(); f.config.welcomeChannelId = channelId;
  await onMemberAdd(f.member, f.ctx);
  assert.deepEqual(f.actions, ['role', 'welcome']); assert.equal(f.held.has(otherRoleId), true); assert.equal(f.held.has(roleId), true);
});
test('cargo de entrada funciona mesmo com boas-vindas desativadas e não é reaplicado', async () => {
  const f = fixture(); await onMemberAdd(f.member, f.ctx); await onMemberAdd(f.member, f.ctx);
  assert.deepEqual(f.actions, ['role']);
});
test('cargo de entrada não é aplicado a bots, outro servidor ou configuração vazia', async () => {
  const f = fixture();
  await onMemberAdd({ ...f.member, user: { bot: true } } as GuildMember, f.ctx);
  await onMemberAdd({ ...f.member, guild: { id: otherRoleId } } as GuildMember, f.ctx);
  f.ctx.env.joinRoleId = ''; await onMemberAdd(f.member, f.ctx); assert.deepEqual(f.actions, []);
});
test('sem Gerenciar cargos ou com hierarquia insuficiente não atribui e mantém boas-vindas', async () => {
  for (const kind of ['permission', 'equal', 'higher']) {
    const f = fixture(); f.config.welcomeChannelId = channelId;
    if (kind === 'permission') f.setPermission(false); else f.setPosition(kind === 'equal' ? 0 : -1);
    await onMemberAdd(f.member, f.ctx); assert.deepEqual(f.actions, ['welcome']);
  }
});
test('cargo inexistente, de integração, @everyone ou falha REST não interrompe recepção', async () => {
  for (const kind of ['missing', 'managed', 'everyone', 'network']) {
    const f = fixture(); f.config.welcomeChannelId = channelId;
    if (kind === 'missing') f.setMissing();
    if (kind === 'managed') f.role.managed = true;
    if (kind === 'everyone') f.role.id = guildId;
    if (kind === 'network') f.setFailAdd();
    await onMemberAdd(f.member, f.ctx); assert.deepEqual(f.actions, ['welcome']);
  }
});
test('variável JOIN_ROLE_ID é opcional e valida ID de cargo', () => {
  const env = { DISCORD_TOKEN: 'synthetic-token-placeholder'.repeat(2), DISCORD_CLIENT_ID: userId, DISCORD_GUILD_ID: guildId };
  assert.equal(loadEnv(env).joinRoleId, '');
  assert.equal(loadEnv({ ...env, JOIN_ROLE_ID: roleId }).joinRoleId, roleId);
  assert.throws(() => loadEnv({ ...env, JOIN_ROLE_ID: 'Convidado' }), /ID válido/);
});

test('entrada pendente aguarda triagem e conclusão atribui cargo sem repetir boas-vindas', async () => {
  const f = fixture(); f.config.welcomeChannelId = channelId;
  f.member.pending = true;
  await onMemberAdd(f.member, f.ctx);
  assert.deepEqual(f.actions, ['welcome']);
  const before = { ...f.member, pending: true } as GuildMember;
  f.member.pending = false;
  await onMemberScreened(before, f.member, f.ctx);
  await onMemberScreened(before, f.member, f.ctx);
  assert.deepEqual(f.actions, ['welcome', 'role']);
  assert.equal(f.held.has(otherRoleId), true);
});

test('troca de apelido ou remoção administrativa de cargo não é tratada como nova entrada', async () => {
  const f = fixture(); f.member.pending = false;
  await onMemberScreened({ ...f.member, pending: false } as GuildMember, f.member, f.ctx);
  await onMemberScreened({ ...f.member, pending: null } as unknown as GuildMember, f.member, f.ctx);
  assert.deepEqual(f.actions, []);
});

function recoveryFixture() {
  const f = fixture(), now = Date.now(), members = new Collection<string, GuildMember>();
  let fail = false;
  const make = (id: string, options: { age?: number; roles?: string[]; bot?: boolean; pending?: boolean } = {}) => {
    const held = new Collection([guildId, ...(options.roles ?? [])].map(id => [id, { id }]));
    const member = { id, guild: f.member.guild, user: { bot: options.bot ?? false }, pending: options.pending ?? false, joinedTimestamp: now - (options.age ?? 1000), roles: { cache: held, add: async (role: string) => { if (fail) throw new Error('Network failure'); assert.equal(role, roleId); f.actions.push(id); held.set(role, { id: role }); } } } as unknown as GuildMember;
    members.set(id, member); return member;
  };
  Object.assign(f.member.guild.members, {
    list: async (options: { limit: number; cache: boolean }) => { assert.equal(options.limit, 200); assert.equal(options.cache, false); return members; },
    fetch: async (options: { user: string; force: boolean; cache: boolean }) => { assert.equal(options.force, true); assert.equal(options.cache, false); return members.get(options.user); },
  });
  return { ...f, make, members, now, setFail: (v: boolean) => { fail = v; } };
}

test('recuperação atribui somente a recentes sem cargo e preserva antigos, equipe, bots e triagem', async () => {
  const f = recoveryFixture();
  const recent = f.make('100000000000000001');
  f.make('100000000000000002', { age: 8 * 86400_000 });
  f.make('100000000000000003', { roles: [otherRoleId] });
  f.make('100000000000000004', { bot: true });
  f.make('100000000000000005', { pending: true });
  f.make('100000000000000006', { roles: [roleId] });
  f.make('100000000000000007', { age: -1000 });
  const result = await recoverJoinRoles(f.ctx, f.now);
  assert.deepEqual(result, { checked: 7, assigned: 1, waitingScreening: 1, truncated: false });
  assert.deepEqual(f.actions, [recent.id]);
  await recoverJoinRoles(f.ctx, f.now);
  assert.deepEqual(f.actions, [recent.id]);
});

test('falha temporária de atribuição é retomada na próxima conferência sem perda de cargos', async () => {
  const f = recoveryFixture(), recent = f.make(userId);
  f.setFail(true); assert.equal((await recoverJoinRoles(f.ctx, f.now)).assigned, 0);
  f.setFail(false); assert.equal((await recoverJoinRoles(f.ctx, f.now)).assigned, 1);
  assert.equal(recent.roles.cache.has(guildId), true);
  assert.deepEqual(f.actions, [userId]);
});

test('conclusão da triagem com membro antigo fora do cache recupera somente recém-chegado sem cargo', async () => {
  const f = recoveryFixture(), recent = f.make(userId);
  await onMemberScreened({ pending: null } as unknown as GuildMember, recent, f.ctx);
  assert.deepEqual(f.actions, [userId]);
});

test('membro aprovado durante varredura não recebe cargo de candidato na consulta final', async () => {
  const f = recoveryFixture(), recent = f.make(userId);
  Object.assign(f.member.guild.members, { fetch: async () => { recent.roles.cache.set(otherRoleId, { id: otherRoleId } as never); return recent; } });
  assert.equal((await recoverJoinRoles(f.ctx, f.now)).assigned, 0);
  assert.deepEqual(f.actions, []); assert.equal(recent.roles.cache.has(otherRoleId), true);
});

test('recuperação pagina sem cache, limita atribuições e evita varreduras concorrentes', async () => {
  const f = recoveryFixture();
  for (let n = 1; n <= 200; n++) f.make(String(100000000000000000n + BigInt(n)), { bot: true });
  const first = new Collection(f.members); f.members.clear();
  for (let n = 201; n <= 230; n++) f.make(String(100000000000000000n + BigInt(n)));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let pages = 0;
  Object.assign(f.member.guild.members, { list: async (options: { cache: boolean; after?: string }) => {
    assert.equal(options.cache, false); pages++;
    if (pages === 1) { assert.equal(options.after, undefined); await gate; return first; }
    assert.equal(options.after, first.last()!.id); return f.members;
  } });
  const scan = recoverJoinRoles(f.ctx, f.now);
  assert.equal((await recoverJoinRoles(f.ctx, f.now)).checked, 0);
  release(); const result = await scan;
  assert.equal(pages, 2); assert.equal(result.assigned, 25); assert.equal(result.truncated, true);
});
