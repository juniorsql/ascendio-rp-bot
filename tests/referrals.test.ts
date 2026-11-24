import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChannelType, Collection, PermissionsBitField, type Client, type Interaction, type MessageCreateOptions } from 'discord.js';
import { Referrals } from '../src/services/referrals.js';

test('indicação confere o cargo, mostra o perfil e recupera um registro sem duplicar', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-referrals-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const guildId = '123456789012345678';
  const channelId = '223456789012345678';
  const inviterRoleId = '323456789012345678';
  const referredRoleId = '423456789012345678';
  const inviterId = '523456789012345678';
  const referredId = '623456789012345678';
  const botId = '723456789012345678';
  const interactionId = '823456789012345678';
  const messageId = '923456789012345678';
  const actorRoles = new Set<string>();
  const referredRoles = new Set<string>();
  const member = {
    id: referredId, displayName: 'Ada Bell', user: { username: 'adabell', bot: false },
    roles: { cache: referredRoles, add: async (id: string) => referredRoles.add(id) },
  };
  const bot = { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { comparePositionTo: () => 1 } } };
  const everyone = { id: guildId };
  const guild = {
    id: guildId, roles: { everyone, fetch: async () => ({ id: referredRoleId, managed: false }) },
    members: { me: bot, fetchMe: async () => bot, fetch: async ({ user }: { user: string }) => user === referredId ? member : { roles: { cache: actorRoles } } },
  };
  const messages = new Collection<string, unknown>();
  const posted: MessageCreateOptions[] = [];
  const channel = {
    id: channelId, guildId, guild, type: ChannelType.GuildText,
    permissionsFor: (who: unknown) => who === everyone ? new PermissionsBitField() : bot.permissions,
    messages: { fetch: async () => messages },
    send: async (options: MessageCreateOptions) => {
      posted.push(options);
      messages.set(messageId, { id: messageId, author: { id: botId }, embeds: options.embeds, createdTimestamp: Date.now() });
      throw new Error('Resposta da publicação perdida');
    },
  };
  const client = { user: { id: botId }, channels: { fetch: async () => channel } } as unknown as Client;
  const referrals = new Referrals(client, guildId, { channelId, inviterRoleId, referredRoleId }, dir);
  await referrals.init();
  const replies: unknown[] = [];
  function interaction(customId: string, candidateRoles: string[] = [], modal = false) {
    return {
      id: interactionId, guildId, guild, channelId, customId, user: { id: inviterId }, member: { roles: candidateRoles },
      isButton: () => !modal, isModalSubmit: () => modal, fields: { getTextInputValue: () => referredId },
      deferReply: async () => undefined, deferUpdate: async () => undefined,
      editReply: async (reply: unknown) => { replies.push(reply); },
    } as unknown as Interaction;
  }
  await assert.rejects(referrals.handle(interaction('referral:open')), /Pode indicar/);
  await referrals.handle(interaction('referral:lookup', [inviterRoleId], true));
  const buttonId = `referral:confirm:${referredId}:${inviterId}`;
  assert.match(JSON.stringify(replies[0]), /Ada Bell.*adabell/);
  assert.ok(JSON.stringify(replies[0]).includes(buttonId));
  assert.equal(referredRoles.size, 0);
  await assert.rejects(referrals.handle(interaction(buttonId, [inviterRoleId])), /Pode indicar/);
  actorRoles.add(inviterRoleId);
  await assert.rejects(referrals.handle(interaction(buttonId, [inviterRoleId])), /Resposta da publicação perdida/);
  const reopened = new Referrals(client, guildId, { channelId, inviterRoleId, referredRoleId }, dir);
  await reopened.handle(interaction(buttonId, [inviterRoleId]));
  assert.deepEqual([...referredRoles], [referredRoleId]);
  assert.match(JSON.stringify(posted[0]), /⭐ Indicação registrada/);
  assert.ok(JSON.stringify(posted[0]).includes(inviterId));
  assert.ok(JSON.stringify(replies[1]).includes(messageId));
  assert.equal(posted.length, 1);
  await assert.rejects(reopened.handle(interaction(buttonId, [inviterRoleId])), /Já existe uma indicação/);
});
