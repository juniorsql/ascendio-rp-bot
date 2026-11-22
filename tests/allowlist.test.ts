import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChannelType, Collection, OverwriteType, PermissionFlagsBits, PermissionsBitField, type Client, type Guild, type MessageCreateOptions } from 'discord.js';
import { answerForm, answersCard, applicationCard } from '../src/allowlist/cards.js';
import { loreLink, sections } from '../src/allowlist/questions.js';
import { Allowlist, type AllowlistConfig } from '../src/allowlist/service.js';
import { AllowlistStore, newApplication } from '../src/allowlist/store.js';

const guildId = '123456789012345678';
const botId = '223456789012345678';
const applicant = '323456789012345678';
const staff = '423456789012345678';
const config: AllowlistConfig = {
  panelChannelId: '523456789012345678', reviewChannelId: '623456789012345678',
  scheduleChannelId: '723456789012345678', resultChannelId: '823456789012345678',
  waitingRoleId: '923456789012345678', staffRoleIds: ['103456789012345678'],
};
const fullPermissions = new PermissionsBitField(PermissionFlagsBits.Administrator);

test('Allowlist organiza as 16 perguntas em cinco partes e exige o link salvo na última', () => {
  assert.deepEqual(sections.flatMap(s => s.questions.map(q => Number(q.id))), Array.from({ length: 16 }, (_, i) => i + 1));
  for (const [index, section] of sections.entries()) {
    const modal = answerForm(String(index)).toJSON();
    assert.equal(modal.components.length, section.questions.length + (index === 4 ? 1 : 0));
  }
  const base = 'https://www.toptal.com/developers/hastebin';
  assert.equal(loreLink(base + '/historiaabc'), base + '/historiaabc');
  assert.equal(loreLink(base + '/raw/historiaabc'), base + '/historiaabc');
  for (const bad of [base, base + '/', 'Uma história', 'https://toptal.com.example.org/developers/hastebin/historiaabc']) {
    assert.throws(() => loreLink(bad), /link do texto salvo/);
  }
});

test('Allowlist restringe a revisão, salva o progresso e publica a aprovação final uma vez', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-allowlist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const staffRoles = new Set(config.staffRoleIds);
  const applicantRoles = new Set<string>();
  const waiting = { id: config.waitingRoleId, managed: false };
  const bot = { permissions: fullPermissions, roles: { highest: { comparePositionTo: () => 1 } } };
  const candidate = { permissions: new PermissionsBitField(), roles: {
    cache: applicantRoles, add: async (id: string) => { applicantRoles.add(id); }, remove: async (id: string) => { applicantRoles.delete(id); },
  } };
  const guild = { id: guildId, ownerId: staff, roles: { fetch: async () => waiting },
    members: { me: bot, fetchMe: async () => bot,
      fetch: async ({ user }: { user: string }) => user === applicant ? candidate : { permissions: new PermissionsBitField(), roles: { cache: staffRoles } },
    },
  };
  const everyone = { id: guildId, type: OverwriteType.Role, allow: new PermissionsBitField(), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) };
  const sent: Array<{ channelId: string; options: MessageCreateOptions }> = [];
  const history = new Map<string, Collection<string, unknown>>();
  const client = { user: { id: botId }, channels: { fetch: async (channelId: string) => ({
    id: channelId, type: ChannelType.GuildText, guildId, guild, permissionsFor: () => fullPermissions,
    permissionOverwrites: { cache: new Collection([[guildId, everyone]]) },
    messages: { fetch: async () => history.get(channelId) ?? new Collection() },
    send: async (options: MessageCreateOptions) => {
      const id = String(900000000000000000n + BigInt(sent.length));
      sent.push({ channelId, options });
      const messages = history.get(channelId) ?? new Collection<string, unknown>();
      messages.set(id, { id, author: { id: botId }, createdTimestamp: Date.now(), content: options.content, embeds: options.embeds });
      history.set(channelId, messages);
      return { id };
    },
  }) } } as unknown as Client;
  const service = new Allowlist(client, guildId, config, dir);
  const discordGuild = guild as unknown as Guild;
  await service.store.init();
  await assert.rejects(service.requireStaff(discordGuild, applicant), /exclusiva da equipe/);
  await service.requireStaff(discordGuild, staff);

  const app = newApplication(applicant);
  app.character = 'Ada Bell';
  const link = 'https://www.toptal.com/developers/hastebin/historiaabc';
  for (const question of sections.flatMap(section => section.questions)) app.answers[question.id] = question.id === '16' ? link : 'Minha resposta de teste.';
  await service.store.save(app);
  const reopened = new AllowlistStore(dir);
  assert.deepEqual(await reopened.get(applicant), app);

  await service.submit(app);
  assert.equal(app.stage, 'review');
  assert.equal(applicantRoles.size, 0);
  assert.equal(sent[0]?.channelId, config.reviewChannelId);
  assert.doesNotMatch(JSON.stringify(sent[0]?.options), /Minha resposta|historiaabc/);
  assert.match(answersCard(app, '4').embeds[0]!.description!, /historiaabc/);
  await assert.rejects(service.approveInterview(app, discordGuild, staff), /ainda precisa ser aprovada/);
  await service.approveForm(app, discordGuild, staff);
  assert.equal(app.stage, 'awaiting');
  assert.equal(applicantRoles.has(config.waitingRoleId), true);
  assert.match(applicationCard(app, config.scheduleChannelId, config.resultChannelId).embeds[0]!.description!, new RegExp(config.scheduleChannelId));

  await service.approveInterview(app, discordGuild, staff);
  await service.approveInterview(app, discordGuild, staff);
  assert.equal(applicantRoles.size, 0);
  assert.equal(app.stage, 'approved');
  assert.equal(sent.filter(message => message.channelId === config.resultChannelId).length, 1);
  assert.deepEqual(sent[1]?.options.allowedMentions, { parse: [], users: [applicant] });
  assert.doesNotMatch(JSON.stringify(sent[1]?.options), /Minha resposta|historiaabc/);
});
