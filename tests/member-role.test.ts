import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits, PermissionsBitField, type GuildMember } from 'discord.js';
import type { Context } from '../src/commands/handler.js';
import { defaults } from '../src/config/defaults.js';
import { loadEnv } from '../src/config/env.js';
import { onMemberAdd } from '../src/events/welcome.js';

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
  const ctx = { env: { guildId, joinRoleId: roleId }, store: { snapshot: () => ({ config }) }, client: { channels: { fetch: async () => channel } } } as unknown as Context;
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
