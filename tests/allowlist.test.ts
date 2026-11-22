import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ChannelType, Collection, ComponentType, MessageFlags, OverwriteType, PermissionFlagsBits, PermissionsBitField, type Client, type Guild, type Interaction, type MessageCreateOptions } from 'discord.js';
import { answersCard, applicationCard, panelCard, reviewCard } from '../src/allowlist/cards.js';
import { allowlistForm, pageCount, pageQuestions, restoreLegacyDraft, resumePage } from '../src/allowlist/form.js';
import { allowlistInteraction } from '../src/allowlist/handler.js';
import { loreLink, questions } from '../src/allowlist/questions.js';
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

test('Allowlist exibe cada pergunta fixa acima de uma resposta inicialmente vazia', () => {
  const questionIds = [];
  assert.deepEqual(Array.from({ length: pageCount }, (_, page) => pageQuestions(page).length), [3, 3, 3, 3, 3, 1]);
  for (let page = 0; page < pageCount; page++) {
    const { components } = allowlistForm(page).toJSON();
    assert.ok(components.length <= 5);
    for (const question of pageQuestions(page)) {
      questionIds.push(Number(question.id));
      const label = components.find(component => component.type === ComponentType.Label && component.component.type === ComponentType.TextInput
        && component.component.custom_id === question.id);
      assert.ok(label?.type === ComponentType.Label && label.component.type === ComponentType.TextInput);
      assert.equal(label.component.custom_id, question.id);
      assert.equal(label.component.value, undefined);
      if (question.id === '16') {
        assert.equal(label.label, 'Link da história');
        assert.equal(label.component.max_length, 2048);
        assert.equal(label.component.style, 1);
      } else {
        assert.match(label.label, new RegExp(`^${question.id}\\. .+\\?$`));
        assert.ok(label.description);
      }
    }
  }
  assert.deepEqual(questionIds, Array.from({ length: 16 }, (_, i) => i + 1));
  assert.doesNotMatch(JSON.stringify(panelCard().components), /toptal|hastebin/i);

  const base = 'https://www.toptal.com/developers/hastebin';
  assert.equal(loreLink(base + '/historiaabc'), base + '/historiaabc');
  assert.equal(loreLink(base + '/raw/historiaabc'), base + '/raw/historiaabc');
  const shared = 'https://hastebin.com/share/historiaabc?source=copy#trecho';
  assert.equal(loreLink(`<${shared}>`), shared);
  assert.equal(loreLink('www.toptal.com/developers/hastebin/historiaabc'), base + '/historiaabc');
  assert.equal(loreLink('https://docs.google.com/document/d/123/edit?usp=sharing'), 'https://docs.google.com/document/d/123/edit?usp=sharing');
  for (const bad of [base, base + '/', 'https://hastebin.com/share/', 'Uma história', 'javascript:alert(1)', 'https://127.0.0.1/story']) {
    assert.throws(() => loreLink(bad), /link|https/i);
  }
});

test('Allowlist reaproveita respostas de rascunhos antigos e retoma da primeira pergunta pendente', () => {
  const app = newApplication(applicant);
  app.formDraft = [questions.slice(0, 3).map(q => `${q.id}. ${q.prompt}\nResposta: ${q.id === '3' ? '' : `Resposta da pessoa ${q.id}`}`).join('\n\n')];
  restoreLegacyDraft(app);
  assert.deepEqual(app.answers, { '1': 'Resposta da pessoa 1', '2': 'Resposta da pessoa 2' });
  assert.equal(resumePage(app), 0);
  const first = allowlistForm(0, app).toJSON().components[0];
  assert.ok(first?.type === ComponentType.Label && first.component.type === ComponentType.TextInput);
  assert.equal(first.component.value, 'Resposta da pessoa 1');
});

for (const decision of ['approved', 'rejected'] as const) test(`Allowlist restringe a revisão e publica uma vez o resultado ${decision}`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-allowlist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const staffRoles = new Set(config.staffRoleIds);
  const applicantRoles = new Set<string>();
  const privateNotices: Array<{ userId: string; options: MessageCreateOptions }> = [];
  let nickname: string | undefined;
  const waiting = { id: config.waitingRoleId, managed: false };
  const bot = { permissions: fullPermissions, roles: { highest: { comparePositionTo: () => 1 } } };
  const candidate = { permissions: new PermissionsBitField(), setNickname: async (name: string) => { nickname = name; }, roles: {
    cache: applicantRoles, add: async (id: string) => { applicantRoles.add(id); }, remove: async (id: string) => { applicantRoles.delete(id); },
  } };
  const guild = { id: guildId, ownerId: staff, roles: { fetch: async () => waiting },
    members: { me: bot, fetchMe: async () => bot,
      fetch: async ({ user }: { user: string }) => user === applicant ? candidate : { permissions: new PermissionsBitField(), roles: { cache: staffRoles } },
    },
  };
  const everyone = { id: guildId, type: OverwriteType.Role, allow: new PermissionsBitField(), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) };
  const sent: Array<{ channelId: string; options: MessageCreateOptions }> = [];
  let loseResultResponse = decision === 'rejected';
  const history = new Map<string, Collection<string, unknown>>();
  const client = { user: { id: botId },
    users: { send: async (userId: string, options: MessageCreateOptions) => {
      privateNotices.push({ userId, options });
      if (decision === 'rejected') throw Object.assign(new Error('DM bloqueada'), { code: 50007 });
    } },
    channels: { fetch: async (channelId: string) => ({
    id: channelId, type: ChannelType.GuildText, guildId, guild, permissionsFor: () => fullPermissions,
    permissionOverwrites: { cache: new Collection([[guildId, everyone]]) },
    messages: { fetch: async () => history.get(channelId) ?? new Collection() },
    send: async (options: MessageCreateOptions) => {
      const id = String(900000000000000000n + BigInt(sent.length));
      sent.push({ channelId, options });
      const messages = history.get(channelId) ?? new Collection<string, unknown>();
      messages.set(id, { id, author: { id: botId }, createdTimestamp: Date.now(), content: options.content, embeds: options.embeds });
      history.set(channelId, messages);
      if (channelId === config.resultChannelId && loseResultResponse) {
        loseResultResponse = false;
        throw Error('Resposta da publicação perdida.');
      }
      return { id };
    },
  }) } } as unknown as Client;
  const service = new Allowlist(client, guildId, config, dir);
  const discordGuild = guild as unknown as Guild;
  await service.store.init();
  await assert.rejects(service.requireStaff(discordGuild, applicant), /exclusiva da equipe/);
  await service.requireStaff(discordGuild, staff);

  const app = newApplication(applicant);
  const link = 'https://hastebin.com/share/historiaabc?source=copy#trecho';
  await service.store.save(app);
  const reopened = new AllowlistStore(dir);
  assert.deepEqual(await reopened.get(applicant), app);
  async function submitPage(page: number, lore = link) {
    const replies: unknown[] = [];
    const interaction = {
      user: { id: applicant }, guild: discordGuild, guildId, customId: `al:answers-v2:${page}`,
      isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => true,
      isFromMessage: () => page > 0, message: { flags: { has: () => true } },
      fields: { getTextInputValue: (id: string) => id === 'character' ? 'Ada Bell' : id === '16' ? lore : 'Minha resposta de teste.' },
      deferReply: async (reply: unknown) => { replies.push(reply); },
      deferUpdate: async () => { replies.push('private update'); },
      editReply: async (reply: unknown) => { replies.push(reply); },
    } as unknown as Interaction;
    await allowlistInteraction(interaction, service);
    assert.deepEqual(replies[0], page === 0 ? { flags: MessageFlags.Ephemeral } : 'private update');
    return JSON.stringify(replies[1]);
  }
  for (let page = 0; page < pageCount - 1; page++) {
    const progress = await submitPage(page);
    assert.match(progress, /Continuar/);
    assert.doesNotMatch(progress, /Enviar para análise/);
    assert.equal(sent.length, 0);
  }
  assert.match(await submitPage(pageCount - 1, 'minha história'), /link compartilhável/);
  assert.equal((await reopened.get(applicant))?.answers['15'], 'Minha resposta de teste.');
  assert.equal(sent.length, 0);
  assert.match(await submitPage(pageCount - 1), /Enviar para análise/);
  assert.equal((await reopened.get(applicant))?.stage, 'draft');
  assert.equal(sent.length, 0);
  assert.equal(nickname, undefined);
  const confirmation: unknown[] = [];
  await allowlistInteraction({
    user: { id: applicant }, guild: discordGuild, guildId, customId: 'al:send',
    isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferUpdate: async () => undefined, editReply: async (reply: unknown) => { confirmation.push(reply); },
  } as unknown as Interaction, service);
  assert.match(JSON.stringify(confirmation[0]), /com a equipe para análise/);
  Object.assign(app, await service.store.get(applicant));
  assert.equal(app.stage, 'review');
  assert.equal(applicantRoles.size, 0);
  assert.equal(sent[0]?.channelId, config.reviewChannelId);
  assert.doesNotMatch(JSON.stringify(sent[0]?.options), /Minha resposta|historiaabc/);
  assert.ok(answersCard(app, '4').embeds[0]!.description!.includes(`<${link}>`));
  assert.equal(nickname, 'Ada Bell');
  assert.equal(privateNotices.length, 0);
  assert.match(JSON.stringify(reviewCard(app).components), /Reprovar e publicar/);
  await assert.rejects(service.publishDecision(app, discordGuild, staff, 'approved'), /etapa atual/);
  await service.approveForm(app, discordGuild, staff);
  await service.approveForm(app, discordGuild, staff);
  assert.equal(privateNotices.length, 1);
  assert.equal(app.formApprovalDm, decision === 'approved' ? 'sent' : 'failed');
  assert.equal(privateNotices[0]?.userId, applicant);
  assert.match(privateNotices[0]?.options.content ?? '', new RegExp(config.scheduleChannelId));
  assert.equal(app.stage, 'awaiting');
  assert.equal(applicantRoles.has(config.waitingRoleId), true);
  assert.match(applicationCard(app, config.scheduleChannelId, config.resultChannelId).embeds[0]!.description!, new RegExp(config.scheduleChannelId));

  assert.match(JSON.stringify(reviewCard(app).components), /Reprovar e publicar/);
  if (decision === 'rejected') {
    await assert.rejects(service.publishDecision(app, discordGuild, staff, decision), /Resposta da publicação perdida/);
    const pending = await reopened.get(applicant);
    assert.equal(pending?.stage, 'publishing');
    assert.equal(pending?.resultDecision, 'rejected');
    await assert.rejects(service.publishDecision(app, discordGuild, staff, 'approved'), /outro resultado em publicação/);
  }
  await service.publishDecision(app, discordGuild, staff, decision);
  await service.publishDecision(app, discordGuild, staff, decision);
  assert.equal(applicantRoles.size, 0);
  assert.equal(app.stage, decision);
  assert.equal(privateNotices.length, 1);
  assert.equal(sent.filter(message => message.channelId === config.resultChannelId).length, 1);
  assert.deepEqual(sent[1]?.options.allowedMentions, { parse: [], users: [applicant] });
  assert.match(JSON.stringify(sent[1]?.options.embeds), new RegExp(decision === 'approved' ? 'ALLOWLIST APROVADA' : 'ALLOWLIST REPROVADA'));
  assert.doesNotMatch(JSON.stringify(sent[1]?.options), /Minha resposta|historiaabc/);
});
