import { OverwriteType, PermissionFlagsBits, type Client, type Guild, type Message, type MessageCreateOptions } from 'discord.js';
import { joinRole } from '../events/member-role.js';
import { errorCode, log } from '../logs/logger.js';
import { target } from '../services/discord.js';
import { snowflake, UserError } from '../validation/input.js';
import { applicationReady, formApprovalResultCard, panelCard, rejectionNotice, resultCard, reviewCard, storyButton } from './cards.js';
import { queuePanel } from './queue.js';
import { AllowlistStore, newApplication, retriesRemaining, type Application, type Decision } from './store.js';

export interface AllowlistConfig {
  panelChannelId: string;
  reviewChannelId: string;
  scheduleChannelId: string;
  resultChannelId: string;
  waitingRoleId: string;
  staffRoleIds: string[];
}

export function allowlistConfig(value: string | undefined): AllowlistConfig | undefined {
  if (!value?.trim()) return;
  const raw = JSON.parse(value) as Partial<AllowlistConfig>;
  const { staffRoleIds } = raw;
  if (!Array.isArray(staffRoleIds) || !staffRoleIds.length) throw new Error('ALLOWLIST_CONFIG exige os cargos da equipe.');
  const config = {
    panelChannelId: snowflake(raw.panelChannelId ?? ''),
    reviewChannelId: snowflake(raw.reviewChannelId ?? ''),
    scheduleChannelId: snowflake(raw.scheduleChannelId ?? ''),
    resultChannelId: snowflake(raw.resultChannelId ?? ''),
    waitingRoleId: snowflake(raw.waitingRoleId ?? ''),
    staffRoleIds: [...new Set(staffRoleIds.map(id => snowflake(id)))],
  };
  if (new Set([config.panelChannelId, config.reviewChannelId, config.scheduleChannelId, config.resultChannelId]).size !== 4) {
    throw new Error('ALLOWLIST_CONFIG exige quatro canais distintos.');
  }
  return config;
}

type Target = Awaited<ReturnType<typeof target>>;

async function findRecent(channel: Target, since: number, matches: (message: Message) => boolean) {
  let before: string | undefined;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, before, cache: false });
    const found = page.find(message => message.createdTimestamp >= since && matches(message));
    if (found) return found;
    const oldest = page.last();
    if (!oldest || page.size < 100 || oldest.createdTimestamp < since) return;
    before = oldest.id;
  }
}

export class Allowlist {
  readonly store: AllowlistStore;

  constructor(private readonly client: Client, readonly guildId: string, readonly config: AllowlistConfig, dataDir: string) {
    if ([config.waitingRoleId, ...config.staffRoleIds].includes(guildId) || config.staffRoleIds.includes(config.waitingRoleId)) {
      throw new Error('Os cargos de equipe e entrevista devem ser distintos e específicos.');
    }
    this.store = new AllowlistStore(dataDir);
  }

  private channel(id: string) { return target(this.client, this.guildId, id); }

  private async reviewChannel() {
    const channel = await this.channel(this.config.reviewChannelId);
    const view = PermissionFlagsBits.ViewChannel;
    const overwrites = channel.permissionOverwrites.cache;
    const everyone = overwrites.get(this.guildId);
    const roleIds = this.config.staffRoleIds;
    const members = [this.client.user?.id, channel.guild.ownerId];
    const unexpected = overwrites.some(overwrite => overwrite.allow.has(view, false) && (
      overwrite.type === OverwriteType.Role ? !roleIds.includes(overwrite.id) : !members.includes(overwrite.id)
    ));
    if (!everyone?.deny.has(view, false) || unexpected) throw new UserError('O canal de análise precisa estar restrito à equipe da Allowlist.');
    return channel;
  }

  async requireStaff(guild: Guild, userId: string) {
    const member = await guild.members.fetch({ user: userId, force: true, cache: false });
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && !this.config.staffRoleIds.some(id => member.roles.cache.has(id))) {
      throw new UserError('Esta ação é exclusiva da equipe da Allowlist.');
    }
    await this.reviewChannel();
  }

  async ensureQueuePanel() {
    const channel = await this.reviewChannel();
    const isPanel = (message: Message) => message.author.id === this.client.user?.id
      && message.components.some(row => 'components' in row && row.components.some(component =>
        'customId' in component && component.customId === 'al:q-list:pending:0'));
    const pins = await channel.messages.fetchPins({ cache: false });
    const pinned = pins.items.find(item => isPanel(item.message));
    if (pinned) return pinned.message.id;
    const recent = await channel.messages.fetch({ limit: 50, cache: false });
    const message = recent.find(isPanel) ?? await channel.send({
      ...queuePanel(), nonce: `al-q-${channel.id}`, enforceNonce: true,
    });
    await message.pin('Central de análise da Allowlist');
    return message.id;
  }

  async ensurePanel() {
    const panel = await this.channel(this.config.panelChannelId);
    const guild = panel.guild;
    const waiting = await joinRole(guild, this.config.waitingRoleId);
    const [, scheduling] = await Promise.all([this.reviewChannel(), this.channel(this.config.scheduleChannelId), this.channel(this.config.resultChannelId)]);
    if (!scheduling.permissionsFor(waiting, false).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) {
      throw new UserError('O cargo Aguardando Entrevista precisa conversar no canal de agendamento.');
    }
    const recent = await panel.messages.fetch({ limit: 50, cache: false });
    const existing = recent.find(message => message.author.id === this.client.user?.id
      && message.components.some(row => 'components' in row && row.components.some(component => 'customId' in component && component.customId === 'al:home')));
    const card = panelCard();
    if (existing) {
      if (existing.embeds[0]?.description !== card.embeds[0]?.description) await existing.edit(card);
      return existing.id;
    }
    return (await panel.send({ ...card, nonce: `al-${this.config.panelChannelId}`, enforceNonce: true })).id;
  }

  async resetOwnerTest(request: string) {
    const match = /^(\d{17,20}):([\da-f]{20})$/.exec(request);
    if (!match) throw new Error('Pedido inválido de reinício da ficha de teste.');
    const userId = match[1]!;
    const nonce = match[2]!;
    const guild = await this.client.guilds.fetch(this.guildId);
    if (guild.ownerId !== userId) throw new Error('A conta indicada não é a dona do servidor.');
    return this.store.run(userId, async () => {
      const current = await this.store.get(userId);
      if (current?.ownerResetRequest === nonce) return false;
      await this.store.save({ ...newApplication(userId), ownerResetRequest: nonce });
      if (current?.reviewerId && (current.stage === 'awaiting' || current.stage === 'publishing')) {
        try {
          const member = await guild.members.fetch({ user: userId, force: true, cache: false });
          if (member.roles.cache.has(this.config.waitingRoleId)) {
            await member.roles.remove(this.config.waitingRoleId, 'Reinício da ficha de teste da Allowlist');
          }
        } catch (error) {
          log('allowlist_test_role_cleanup_failed', { guildId: this.guildId, code: errorCode(error) }, 'warn');
        }
      }
      if (current?.reviewId) {
        try {
          const channel = await this.reviewChannel();
          const message = await channel.messages.fetch({ message: current.reviewId, cache: false });
          if (message.author.id === this.client.user?.id) {
            await message.edit({
              embeds: [{ title: '🧪 Ficha de teste reiniciada', description: 'A ficha foi limpa para um novo teste.', color: 0xb69a60 }],
              components: [],
              allowedMentions: { parse: [] },
            });
          }
        } catch (error) {
          log('allowlist_test_card_cleanup_failed', { guildId: this.guildId, code: errorCode(error) }, 'warn');
        }
      }
      log('allowlist_owner_test_reset', {
        guildId: this.guildId,
        action: `previousStage=${current?.stage ?? 'none'}, answers=${Object.keys(current?.answers ?? {}).length}, storyLinkSaved=${Boolean(current?.answers['16'])}`,
      });
      return true;
    });
  }

  async startRetry(userId: string, applicationId: string | undefined) {
    return this.store.run(userId, async () => {
      const app = await this.store.get(userId);
      if (!app || app.id !== applicationId || app.stage !== 'rejected') {
        throw new UserError('Abra o painel para consultar sua ficha atual.');
      }
      if (retriesRemaining(app) === 0) throw new UserError('Você já usou todas as tentativas da Allowlist.');
      await this.notifyRejection(app);
      const { previousAttempts = [], ...previous } = app;
      const next: Application = {
        ...newApplication(userId),
        previousAttempts: [...previousAttempts, previous],
        ownerResetRequest: app.ownerResetRequest,
      };
      await this.store.save(next);
      return next;
    });
  }

  async submit(app: Application) {
    if (app.stage !== 'draft' && app.stage !== 'submitting') throw new UserError('Sua ficha já foi enviada para a equipe.');
    if (!applicationReady(app)) throw new UserError('Responda às 16 perguntas antes de enviar.');
    const channel = await this.reviewChannel();
    const retry = app.stage === 'submitting';
    if (!retry) {
      if (app.reviewId) {
        app.id = newApplication(app.userId).id;
        delete app.reviewId;
      }
      app.stage = 'submitting';
      app.submittedAt = Date.now();
      await this.store.save(app);
    }
    const existing = retry && await findRecent(channel, app.submittedAt! - 10_000, message =>
      message.author.id === this.client.user?.id && message.embeds[0]?.footer?.text === `Ficha ${app.id}`);
    const message = existing || await channel.send({ ...reviewCard(app), nonce: `al-r-${app.id}`, enforceNonce: true });
    app.reviewId = message.id;
    try {
      const member = await channel.guild.members.fetch({ user: app.userId, force: true, cache: false });
      const nickname = app.character.slice(0, 32).replace(/[\uD800-\uDBFF]$/, '').trimEnd();
      if (member.nickname !== nickname) await member.setNickname(nickname, 'Nome do personagem na Allowlist');
      app.nicknameApplied = true;
    } catch (error) {
      app.nicknameApplied = false;
      log('allowlist_nickname_failed', { guildId: this.guildId, userId: app.userId, code: errorCode(error) }, 'warn');
    }
    app.stage = 'review';
    delete app.feedback;
    delete app.formDraft;
    await this.store.save(app);
  }

  async approveForm(app: Application, guild: Guild, reviewerId: string) {
    if (app.stage !== 'review' && app.stage !== 'awaiting') throw new UserError('Esta ficha já passou pela análise.');
    if (app.stage === 'review') {
      const role = await joinRole(guild, this.config.waitingRoleId);
      const candidate = await guild.members.fetch({ user: app.userId, force: true, cache: false });
      if (candidate.pending) throw new UserError('O candidato precisa concluir a entrada no Discord antes de receber o cargo.');
      if (!candidate.roles.cache.has(role.id)) await candidate.roles.add(role.id, 'Formulário de Allowlist aprovado');
      app.stage = 'awaiting';
      app.reviewerId = reviewerId;
      app.formApprovedAt = Date.now();
      app.formApprovalResultId = null;
      await this.store.save(app);
    }
    await this.finishFormApproval(app);
  }

  private async finishFormApproval(app: Application) {
    await this.notifyFormApproval(app);
    if (app.formApprovalResultId !== null) return;
    try {
      const channel = await this.channel(this.config.resultChannelId);
      const post = formApprovalResultCard(app, this.config.scheduleChannelId);
      const existing = await findRecent(channel, (app.formApprovedAt ?? Date.now()) - 10_000, message =>
        message.author.id === this.client.user?.id && message.embeds[0]?.footer?.text === post.embeds[0]!.footer.text);
      const message = existing ?? await channel.send({ ...post, nonce: `al-a-${app.id}`, enforceNonce: true });
      await this.store.save({ ...app, formApprovalResultId: message.id });
      app.formApprovalResultId = message.id;
    } catch (error) {
      log('allowlist_form_approval_result_pending', { guildId: this.guildId, userId: app.userId, code: errorCode(error) }, 'warn');
    }
  }

  private async notifyFormApproval(app: Application) {
    if (app.formApprovalDm) return;
    try {
      await this.client.users.send(app.userId, {
        content: '✨ **Seu formulário da Allowlist foi aprovado!**\n\nParabéns! Você recebeu o cargo **Aguardando Entrevista** no Ascendio RP. Fique de olho no canal de agendamento e envie sua disponibilidade para combinar o horário com a staff. Boa sorte!\n\n'
          + `[Agendar entrevista](https://discord.com/channels/${this.guildId}/${this.config.scheduleChannelId})`,
        allowedMentions: { parse: [] },
        nonce: `al-d-${app.id}`,
        enforceNonce: true,
      });
      app.formApprovalDm = 'sent';
    } catch (error) {
      app.formApprovalDm = 'failed';
      log('allowlist_approval_dm_failed', { guildId: this.guildId, userId: app.userId, code: errorCode(error) }, 'warn');
    }
    await this.store.save(app);
  }

  async publishDecision(app: Application, guild: Guild, staffId: string, decision: Decision) {
    if (app.stage === decision) return this.notifyRejection(app);
    const retry = app.stage === 'publishing';
    if (retry && (app.resultDecision ?? 'approved') !== decision) {
      throw new UserError('Já existe outro resultado em publicação para esta ficha.');
    }
    if (!retry && app.stage !== 'awaiting' && !(app.stage === 'review' && decision === 'rejected')) {
      throw new UserError('Este resultado não está disponível para a etapa atual da ficha.');
    }
    if (app.formApprovalResultId === null) {
      await this.finishFormApproval(app);
      if (app.formApprovalResultId === null) throw new UserError('A publicação da aprovação do formulário ainda está pendente. Tente novamente.');
    }
    const channel = await this.channel(this.config.resultChannelId);
    const candidate = await guild.members.fetch({ user: app.userId, force: true, cache: false });
    if (!retry) {
      if (!channel.permissionsFor(candidate)?.has(PermissionFlagsBits.ViewChannel)) throw new UserError('O candidato precisa ter acesso ao canal de resultado.');
      app.stage = 'publishing';
      app.resultDecision = decision;
      app.resultStartedAt = Date.now();
      if (decision === 'approved') app.interviewerId = staffId;
      else app.rejectedById = staffId;
      await this.store.save(app);
    }
    if (candidate.roles.cache.has(this.config.waitingRoleId)) {
      await candidate.roles.remove(this.config.waitingRoleId, 'Avaliação de Allowlist concluída');
    }
    const post = resultCard(app, decision);
    const existing = retry && await findRecent(channel, app.resultStartedAt! - 10_000, message =>
      message.author.id === this.client.user?.id && message.content === post.content && message.embeds[0]?.title === post.embeds[0]?.title
        && !app.previousAttempts?.some(previous => previous.resultId === message.id));
    const message = existing || await channel.send({ ...post, nonce: `al-f-${app.id}`, enforceNonce: true } satisfies MessageCreateOptions);
    app.resultId = message.id;
    app.stage = decision;
    app.decidedAt = Date.now();
    if (decision === 'rejected') app.rejectionDm = 'pending';
    await this.store.save(app);
    await this.notifyRejection(app);
  }

  private async notifyRejection(app: Application) {
    if (app.stage !== 'rejected' || app.rejectionDm !== 'pending' || !app.resultId) return;
    const result = `https://discord.com/channels/${this.guildId}/${this.config.resultChannelId}/${app.resultId}`;
    const panel = `https://discord.com/channels/${this.guildId}/${this.config.panelChannelId}`;
    try {
      await this.client.users.send(app.userId, {
        ...rejectionNotice(app, result, panel),
        nonce: `al-n-${app.id}`,
        enforceNonce: true,
      });
      app.rejectionDm = 'sent';
    } catch (error) {
      app.rejectionDm = 'failed';
      log('allowlist_rejection_dm_failed', { guildId: this.guildId, userId: app.userId, code: errorCode(error) }, 'warn');
    }
    await this.store.save(app);
  }

  async refreshActiveReviews() {
    const channel = await this.reviewChannel();
    for (const userId of await this.store.userIds()) {
      try {
        await this.store.run(userId, async () => {
          const app = await this.store.get(userId);
          if (!app) return;
          if (app.stage === 'awaiting' && app.formApprovalResultId === null) await this.finishFormApproval(app);
          await this.notifyRejection(app);
          if (!app.reviewId || !['review', 'awaiting', 'publishing', 'approved', 'rejected'].includes(app.stage)) return;
          const message = await channel.messages.fetch({ message: app.reviewId, cache: false });
          if (message.author.id !== this.client.user?.id) return;
          const buttonLabel = app.stage === 'publishing' ? 'Concluir publicação' : 'Reprovar e publicar';
          const alreadyUpdated = message.components.some(row => 'components' in row
            && row.components.some(component => 'label' in component && component.label === buttonLabel));
          const missingStory = storyButton(app) && !message.components.some(row => 'components' in row
            && row.components.some(component => 'url' in component && component.url === app.answers['16']));
          const final = app.stage === 'approved' || app.stage === 'rejected';
          const locked = ['Aprovar entrevista e publicar', 'Reprovar e publicar'].every(label =>
            message.components.some(row => 'components' in row && row.components.some(component =>
              'label' in component && component.label === label && 'disabled' in component && component.disabled)));
          const updatedText = message.embeds[0]?.description === reviewCard(app).embeds[0]?.description;
          const hasReader = message.components.some(row => 'components' in row && row.components.some(component =>
            'customId' in component && component.customId === `al:q-open:${app.userId}:${app.id}:0`));
          if (!(final ? locked : alreadyUpdated) || missingStory || !updatedText || !hasReader) await this.refreshReview(message, app);
        });
      } catch (error) {
        log('allowlist_review_upgrade_failed', { channelId: channel.id, code: errorCode(error) }, 'warn');
      }
    }
  }

  async refreshReview(message: Message | undefined, app: Application) {
    try {
      if (message) await message.edit(reviewCard(app));
      else if (app.reviewId) {
        const channel = await this.reviewChannel();
        const source = await channel.messages.fetch({ message: app.reviewId, cache: false });
        if (source.author.id === this.client.user?.id) await source.edit(reviewCard(app));
      }
    } catch (error) {
      log('allowlist_review_refresh_failed', { channelId: this.config.reviewChannelId, messageId: app.reviewId, code: errorCode(error) }, 'warn');
    }
  }
}
