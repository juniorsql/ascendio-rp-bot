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
import { queuePage, staffReading } from '../src/allowlist/queue.js';
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

test('Allowlist exibe cada pergunta completa imediatamente antes do respectivo campo vazio', () => {
  const questionIds = [];
  assert.deepEqual(Array.from({ length: pageCount }, (_, page) => pageQuestions(page).length), [2, 2, 2, 2, 2, 2, 2, 2]);
  for (let page = 0; page < pageCount; page++) {
    const { components } = allowlistForm(page).toJSON();
    assert.ok(components.length <= 5);
    for (const question of pageQuestions(page)) {
      const prompt = components.findIndex(component => component.type === ComponentType.TextDisplay
        && component.content === `**${question.id}.** ${question.prompt}`);
      assert.ok(prompt >= 0);
      questionIds.push(Number(question.id));
      const label = components[prompt + 1];
      assert.ok(label?.type === ComponentType.Label && label.component.type === ComponentType.TextInput);
      assert.equal(label.component.custom_id, question.id);
      assert.equal(label.component.value, undefined);
      assert.equal(label.component.required, false);
      if (question.id === '16') {
        assert.equal(label.label, 'Link da história');
        assert.equal(label.component.max_length, 2048);
        assert.equal(label.component.style, 1);
        const name = components[prompt + 2];
        assert.ok(name?.type === ComponentType.Label && name.component.type === ComponentType.TextInput);
        assert.equal(name.component.custom_id, 'character');
        assert.equal(name.component.required, false);
      } else {
        assert.equal(label.label, '\u200B');
        assert.equal(label.component.style, 2);
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
  assert.equal(loreLink(`[Minha história](${shared})`), shared);
  assert.equal(loreLink('hastebin.com/share/historiaabc'), 'https://hastebin.com/share/historiaabc');
  assert.equal(loreLink('http://example.org/historia'), 'http://example.org/historia');
  assert.equal(loreLink(base), base);
  assert.equal(loreLink('www.toptal.com/developers/hastebin/historiaabc'), base + '/historiaabc');
  assert.equal(loreLink('https://docs.google.com/document/d/123/edit?usp=sharing'), 'https://docs.google.com/document/d/123/edit?usp=sharing');
  for (const bad of ['Uma história', 'javascript:alert(1)', 'file://example.org/story', 'https://user:pass@example.org/story']) {
    assert.throws(() => loreLink(bad), /endereço da história/i);
  }
});

test('reinicia apenas a ficha do dono e aplica o mesmo pedido uma vez', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-allowlist-reset-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const roles = new Set([config.waitingRoleId, config.staffRoleIds[0]!]);
  const guild = { ownerId: staff, members: {
    me: {},
    fetch: async () => ({ roles: { cache: roles, remove: async (id: string) => roles.delete(id) } }),
  } };
  const overwrites = new Collection([[guildId, {
    id: guildId, type: OverwriteType.Role, allow: new PermissionsBitField(),
    deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
  }]]);
  const edits: Array<{ components: unknown[]; embeds: Array<{ title: string }> }> = [];
  const client = { user: { id: botId }, guilds: { fetch: async () => guild }, channels: {
    fetch: async () => ({
      guildId, guild, type: ChannelType.GuildText, permissionsFor: () => fullPermissions,
      permissionOverwrites: { cache: overwrites },
      messages: { fetch: async () => ({ author: { id: botId }, edit: async (data: typeof edits[number]) => edits.push(data) }) },
    }),
  } } as unknown as Client;
  const service = new Allowlist(client, guildId, config, dir);
  await service.store.init();
  const original = newApplication(staff);
  original.stage = 'awaiting';
  original.reviewerId = staff;
  original.reviewId = '983456789012345678';
  original.answers['1'] = 'Dado de teste';
  const other = newApplication(applicant);
  await service.store.save(original);
  await service.store.save(other);
  const request = `${staff}:0123456789abcdefabcd`;
  await assert.rejects(service.resetOwnerTest(`${applicant}:0123456789abcdefabcd`), /não é a dona/);
  assert.equal(await service.resetOwnerTest(request), true);
  const fresh = (await service.store.get(staff))!;
  assert.notEqual(fresh.id, original.id);
  assert.equal(fresh.stage, 'draft');
  assert.deepEqual(fresh.answers, {});
  assert.deepEqual([...roles], config.staffRoleIds);
  assert.match(edits[0]?.embeds[0]?.title ?? '', /Ficha de teste reiniciada/);
  assert.deepEqual(edits[0]?.components, []);
  fresh.answers['1'] = 'Novo teste';
  await service.store.save(fresh);
  assert.equal(await service.resetOwnerTest(request), false);
  assert.equal(edits.length, 1);
  assert.deepEqual(await service.store.get(staff), fresh);
  assert.deepEqual(await service.store.get(applicant), other);
});

test('Allowlist reaproveita respostas de rascunhos antigos e retoma da primeira pergunta pendente', () => {
  const app = newApplication(applicant);
  app.formDraft = [questions.slice(0, 3).map(q => `${q.id}. ${q.prompt}\nResposta: ${q.id === '3' ? '' : `Resposta da pessoa ${q.id}`}`).join('\n\n')];
  restoreLegacyDraft(app);
  assert.deepEqual(app.answers, { '1': 'Resposta da pessoa 1', '2': 'Resposta da pessoa 2' });
  assert.equal(resumePage(app), 1);
  const first = allowlistForm(0, app).toJSON().components[1];
  assert.ok(first?.type === ComponentType.Label && first.component.type === ComponentType.TextInput);
  assert.equal(first.component.value, 'Resposta da pessoa 1');
});

test('Allowlist recupera o nome e o link de um rascunho com o enunciado antigo da pergunta 16', () => {
  const app = newApplication(applicant);
  const link = 'https://hastebin.com/share/historiaabc';
  app.formDraft = ['', '', '', '',
    '16. Conte a história do personagem que pretende interpretar. Apresente nome, idade, origem, família, personalidade, qualidades, defeitos, acontecimentos marcantes, objetivos e motivações. Explique como ele se encaixa em 1940 e o que o levou à região de Hogwarts. Habilidades especiais e vínculos extraordinários dependem de aprovação da equipe.\n\nEscreva a história no Hastebin, salve e cole o link do texto salvo no formulário.\n' +
    `Nome do personagem: Ada Bell\nLink da história: ${link}`,
  ];
  restoreLegacyDraft(app);
  assert.equal(app.character, 'Ada Bell');
  assert.equal(app.answers['16'], link);
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
  let loseFormApprovalResponse = decision === 'approved';
  let blockRejectionDm = false;
  const history = new Map<string, Collection<string, unknown>>();
  const client = { user: { id: botId },
    users: { send: async (userId: string, options: MessageCreateOptions) => {
      privateNotices.push({ userId, options });
      if (blockRejectionDm || (decision === 'rejected' && String(options.nonce).startsWith('al-d-'))) {
        throw Object.assign(new Error('DM bloqueada'), { code: 50007 });
      }
    } },
    channels: { fetch: async (channelId: string) => ({
    id: channelId, type: ChannelType.GuildText, guildId, guild, permissionsFor: () => fullPermissions,
    permissionOverwrites: { cache: new Collection([[guildId, everyone]]) },
    messages: { fetch: async ({ message }: { message?: string }) => message
      ? history.get(channelId)?.get(message)
      : history.get(channelId) ?? new Collection() },
    send: async (options: MessageCreateOptions) => {
      const id = String(900000000000000000n + BigInt(sent.length));
      sent.push({ channelId, options });
      const messages = history.get(channelId) ?? new Collection<string, unknown>();
      messages.set(id, { id, author: { id: botId }, createdTimestamp: Date.now(), content: options.content, embeds: options.embeds,
        edit: async () => undefined });
      history.set(channelId, messages);
      if (channelId === config.resultChannelId && String(options.nonce).startsWith('al-a-') && loseFormApprovalResponse) {
        loseFormApprovalResponse = false;
        throw Error('Resposta da publicação recebida com atraso.');
      }
      if (channelId === config.resultChannelId && String(options.nonce).startsWith('al-f-') && loseResultResponse) {
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
  async function submitPage(page: number, lore = link, action = 'answers-v3', answers: Record<string, string> = {}, id?: string) {
    const replies: unknown[] = [];
    const interaction = {
      user: { id: applicant }, guild: discordGuild, guildId, customId: `al:${action}:${page}${id ? `:${id}` : ''}`,
      isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => true,
      isFromMessage: () => page > 0, message: { flags: { has: () => true } },
      fields: { getTextInputValue: (id: string) => answers[id] ?? (id === 'character' ? 'Ada Bell' : id === '16' ? lore : 'Minha resposta de teste.') },
      deferReply: async (reply: unknown) => { replies.push(reply); },
      deferUpdate: async () => { replies.push('private update'); },
      editReply: async (reply: unknown) => { replies.push(reply); },
    } as unknown as Interaction;
    await allowlistInteraction(interaction, service);
    assert.deepEqual(replies[0], page === 0 ? { flags: MessageFlags.Ephemeral } : 'private update');
    return JSON.stringify(replies[1]);
  }
  assert.match(await submitPage(0, link, 'answers-v3', { '2': '' }), /2\. Derrota em um duelo/);
  assert.deepEqual(Object.keys((await reopened.get(applicant))!.answers), ['1']);
  const resumed = await submitPage(0, link, 'answers-v2');
  assert.deepEqual(Object.keys((await reopened.get(applicant))!.answers), ['1', '2', '3']);
  assert.match(resumed, /al:page-v3:1/);
  for (let page = 0; page < pageCount - 1; page++) {
    const progress = await submitPage(page);
    assert.match(progress, /Continuar/);
    assert.doesNotMatch(progress, /Enviar para análise/);
    assert.equal(sent.length, 0);
  }
  assert.match(await submitPage(pageCount - 1, link, 'answers-v3', { character: '' }), /Nome do personagem/);
  assert.match(await submitPage(pageCount - 1, 'minha história'), /endereço da história/);
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
  assert.doesNotMatch(JSON.stringify(sent[0]?.options), /Minha resposta/);
  assert.ok(JSON.stringify(sent[0]?.options).includes(link));
  assert.equal(answersCard(app, '4').embeds[0]?.url, link);
  assert.ok(JSON.stringify(answersCard(app, '4').components).includes(link));
  assert.equal(nickname, 'Ada Bell');
  assert.equal(privateNotices.length, 0);
  assert.match(JSON.stringify(reviewCard(app).components), /Reprovar e publicar/);
  await assert.rejects(service.publishDecision(app, discordGuild, staff, 'approved'), /etapa atual/);
  async function staffClick(id: string, user = staff, ephemeral = true) {
    const calls: unknown[] = [];
    await allowlistInteraction({
      user: { id: user }, guild: discordGuild, guildId, channelId: config.reviewChannelId, customId: id,
      message: { id: '223456789012345670', flags: { has: () => ephemeral } },
      isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
      deferReply: async (options: unknown) => calls.push(options), deferUpdate: async () => calls.push('update'),
      editReply: async (reply: unknown) => calls.push(reply),
    } as unknown as Interaction, service);
    return calls;
  }
  await assert.rejects(staffClick('al:q-list:pending:0', applicant, false), /exclusiva da equipe/);
  const list = await staffClick('al:q-list:pending:0', staff, false);
  assert.deepEqual(list[0], { flags: MessageFlags.Ephemeral });
  assert.match(JSON.stringify(list[1]), /Ada Bell.*Aguardando análise/);
  const key = `${applicant}:${app.id}`;
  const reading = await staffClick(`al:q-open:${key}:1`);
  assert.equal(reading[0], 'update');
  assert.match(JSON.stringify(reading[1]), /Durante uma aula.*Minha resposta de teste/);
  assert.match(JSON.stringify(reading[1]), /Abrir história/);
  await assert.rejects(staffClick(`al:q-form-pass:${key}:1`, staff, false), /Abra a ficha pela fila/);
  const approvalView = await staffClick(`al:q-form-pass:${key}:1`);
  assert.equal(approvalView[0], 'update');
  assert.match(JSON.stringify(approvalView[1]), /Formulário aprovado por/);
  Object.assign(app, await reopened.get(applicant));
  if (decision === 'approved') {
    assert.equal((await reopened.get(applicant))?.formApprovalResultId, null);
    assert.match(JSON.stringify(reviewCard(app).components), /Publicar aprovação do formulário/);
  }
  await service.approveForm(app, discordGuild, staff);
  assert.equal(privateNotices.length, 1);
  assert.equal(app.formApprovalDm, decision === 'approved' ? 'sent' : 'failed');
  assert.equal(privateNotices[0]?.userId, applicant);
  assert.match(privateNotices[0]?.options.content ?? '', /recebeu o cargo \*\*Aguardando Entrevista\*\*/);
  assert.match(privateNotices[0]?.options.content ?? '', new RegExp(config.scheduleChannelId));
  const announcements = () => sent.filter(message => message.channelId === config.resultChannelId);
  assert.equal(announcements().length, 1);
  assert.ok((await reopened.get(applicant))?.formApprovalResultId);
  const approval = announcements()[0]?.options;
  assert.deepEqual(approval?.allowedMentions, { parse: [], users: [applicant] });
  assert.match(JSON.stringify(approval?.embeds), /FORMULÁRIO APROVADO/);
  assert.match(JSON.stringify(approval?.embeds), new RegExp(config.scheduleChannelId));
  assert.doesNotMatch(JSON.stringify(approval?.embeds), /Minha resposta|historiaabc/);
  assert.equal(app.stage, 'awaiting');
  assert.ok(app.formApprovedAt);
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
  assert.ok(app.decidedAt);
  const card = reviewCard(app);
  assert.match(card.embeds[0]?.description ?? '', /Formulário aprovado.*<t:\d+:f>/);
  assert.match(card.embeds[0]?.description ?? '', /(?:Entrevista aprovada|Reprovada).*<t:\d+:f>/);
  const buttons = card.components.map(row => row.toJSON().components).flat().filter(part => part.type === ComponentType.Button);
  const decisionButtons = buttons.filter(part => 'custom_id' in part && !part.custom_id.startsWith('al:q-open:'));
  assert.equal(decisionButtons.length, 2);
  assert.ok(decisionButtons.every(part => part.disabled === true));
  assert.ok(buttons.some(part => 'url' in part && part.url === link && !part.disabled));
  const staleEdits: unknown[] = [];
  await assert.rejects(allowlistInteraction({
    user: { id: staff }, guild: discordGuild, guildId, channelId: config.reviewChannelId,
    customId: `al:${decision === 'approved' ? 'interview-pass' : 'reject'}:${applicant}:${app.id}`,
    message: { id: app.reviewId, edit: async (options: unknown) => staleEdits.push(options) },
    isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferReply: async () => undefined,
  } as unknown as Interaction, service), /resultado desta ficha já foi publicado/);
  assert.equal(staleEdits.length, 1);
  assert.equal(privateNotices.length, decision === 'rejected' ? 2 : 1);
  assert.equal(announcements().length, 2);
  const result = announcements()[1]?.options;
  assert.deepEqual(result?.allowedMentions, { parse: [], users: [applicant] });
  assert.match(JSON.stringify(result?.embeds), new RegExp(decision === 'approved' ? 'ALLOWLIST APROVADA' : 'ALLOWLIST REPROVADA'));
  assert.doesNotMatch(JSON.stringify(result), /Minha resposta|historiaabc/);
  assert.match(JSON.stringify((await staffClick('al:q-list:pending:0'))[1]), /Nenhuma ficha aguardando/);
  const historyView = (await staffClick('al:q-list:history:0'))[1];
  assert.match(JSON.stringify(historyView), /Ada Bell/);
  assert.match(JSON.stringify((await staffClick(`al:q-open:${key}:0`))[1]), new RegExp(decision === 'approved' ? 'Entrevista aprovada por' : 'Reprovada'));
  if (decision === 'approved') return;

  assert.equal((await reopened.get(applicant))?.rejectionDm, 'sent');
  assert.equal(privateNotices[1]?.userId, applicant);
  assert.match(privateNotices[1]?.options.content ?? '', /candidatura no Ascendio RP foi reprovada/);
  assert.match(privateNotices[1]?.options.content ?? '', /\*\*2 chances\*\*/);
  assert.match(JSON.stringify(privateNotices[1]?.options.components), new RegExp(config.panelChannelId));
  assert.match(JSON.stringify(applicationCard(app, config.scheduleChannelId, config.resultChannelId)), /Refazer Allowlist/);

  const retryReplies: unknown[] = [];
  await allowlistInteraction({
    user: { id: applicant }, guild: discordGuild, guildId, customId: `al:retry:${app.id}`,
    isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
    deferUpdate: async () => undefined, editReply: async (reply: unknown) => { retryReplies.push(reply); },
  } as unknown as Interaction, service);
  const second = (await reopened.get(applicant))!;
  assert.notEqual(second.id, app.id);
  assert.equal(second.stage, 'draft');
  assert.deepEqual(second.answers, {});
  assert.equal(second.previousAttempts?.[0]?.resultId, app.resultId);
  assert.match(JSON.stringify(retryReplies[0]), /Tentativa 2 de 3/);
  await assert.rejects(service.startRetry(applicant, app.id), /ficha atual/);
  await assert.rejects(service.startRetry(staff, app.id), /ficha atual/);
  await assert.rejects(submitPage(0), /ficha anterior/);
  await submitPage(0, link, 'answers-v3', {}, second.id);
  assert.equal((await reopened.get(applicant))?.answers['2'], 'Minha resposta de teste.');
  const archivedReplies: unknown[] = [];
  await allowlistInteraction({
    user: { id: staff }, guild: discordGuild, guildId, channelId: config.reviewChannelId,
    customId: `al:read:${applicant}:${app.id}`, message: { id: app.reviewId }, values: ['4'],
    isChatInputCommand: () => false, isButton: () => false, isStringSelectMenu: () => true, isModalSubmit: () => false,
    deferReply: async () => undefined, editReply: async (reply: unknown) => { archivedReplies.push(reply); },
  } as unknown as Interaction, service);
  assert.ok(JSON.stringify(archivedReplies).includes(link));

  Object.assign(second, { character: app.character, answers: { ...app.answers } });
  await service.submit(second);
  loseResultResponse = true;
  blockRejectionDm = true;
  await assert.rejects(service.publishDecision(second, discordGuild, staff, 'rejected'), /Resposta da publicação perdida/);
  await service.publishDecision(second, discordGuild, staff, 'rejected');
  assert.notEqual(second.resultId, app.resultId);
  assert.equal(second.rejectionDm, 'failed');
  assert.match(privateNotices[2]?.options.content ?? '', /\*\*1 chance\*\*/);

  const third = await service.startRetry(applicant, second.id);
  Object.assign(third, { character: app.character, answers: { ...app.answers } });
  await service.submit(third);
  blockRejectionDm = false;
  await service.publishDecision(third, discordGuild, staff, 'rejected');
  assert.equal(third.previousAttempts?.length, 2);
  assert.equal(third.rejectionDm, 'sent');
  assert.match(privateNotices[3]?.options.content ?? '', /usou as \*\*3 tentativas\*\*/);
  assert.doesNotMatch(JSON.stringify(privateNotices[3]?.options), /Refazer Allowlist|Abrir painel da Allowlist/);
  assert.equal(applicationCard(third, config.scheduleChannelId, config.resultChannelId).components.length, 0);
  await assert.rejects(service.startRetry(applicant, third.id), /todas as tentativas/);
  assert.equal(announcements().length, 4);
});

test('fila pagina das fichas mais antigas e leitura mantém o texto completo dentro dos limites do Discord', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ascendio-queue-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new AllowlistStore(dir);
  await store.init();
  for (let n = 7; n >= 1; n--) {
    const app = newApplication(String(600000000000000000n + BigInt(n)));
    await store.save({ ...app, stage: 'review', character: `Personagem - ${n}`, submittedAt: n, reviewId: guildId });
  }
  const first = await queuePage(store, 'pending', 0);
  const second = await queuePage(store, 'pending', 1);
  assert.match(first.embeds[0]!.description, /Personagem - 1[\s\S]*Personagem - 5/);
  assert.doesNotMatch(first.embeds[0]!.description, /Personagem - 6/);
  assert.match(second.embeds[0]!.description, /Personagem - 6[\s\S]*Personagem - 7/);
  assert.equal(first.components[0]!.toJSON().components.length, 5);
  assert.equal(second.components[0]!.toJSON().components.length, 2);

  const app = newApplication(applicant);
  const answer = '*'.repeat(800);
  const story = `https://example.org/${'x'.repeat(700)}`;
  app.answers = { '1': answer, '2': answer, '16': story };
  const reading = staffReading(app, 0);
  const body = reading.embeds[1]?.description ?? '';
  assert.ok(body.includes(questions[0]!.prompt));
  assert.ok(body.includes(questions[1]!.prompt));
  assert.equal(body.split('\n').filter(line => line.replaceAll('\\', '') === answer).length, 2);
  assert.ok(body.length <= 4096);
  assert.equal(staffReading(app, 7).embeds[1]?.url, story);
});
