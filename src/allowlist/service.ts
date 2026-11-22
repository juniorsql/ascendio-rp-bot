import { OverwriteType, PermissionFlagsBits, type Client, type Guild, type Message, type MessageCreateOptions } from 'discord.js';
import { joinRole } from '../events/member-role.js';
import { errorCode, log } from '../logs/logger.js';
import { target } from '../services/discord.js';
import { snowflake, UserError } from '../validation/input.js';
import { applicationReady, panelCard, resultCard, reviewCard } from './cards.js';
import { AllowlistStore, newApplication, type Application } from './store.js';

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
    return (existing ?? await panel.send({ ...panelCard(), nonce: `al-${this.config.panelChannelId}`, enforceNonce: true })).id;
  }

  async submit(app: Application) {
    if (app.stage !== 'draft' && app.stage !== 'submitting') throw new UserError('Sua ficha já foi enviada para a equipe.');
    if (!applicationReady(app)) throw new UserError('Responda às cinco partes antes de enviar.');
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
    app.stage = 'review';
    delete app.feedback;
    await this.store.save(app);
  }

  async approveForm(app: Application, guild: Guild, reviewerId: string) {
    if (app.stage === 'awaiting') return;
    if (app.stage !== 'review') throw new UserError('Esta ficha já passou pela análise.');
    const role = await joinRole(guild, this.config.waitingRoleId);
    const candidate = await guild.members.fetch({ user: app.userId, force: true, cache: false });
    if (candidate.pending) throw new UserError('O candidato precisa concluir a entrada no Discord antes de receber o cargo.');
    await candidate.roles.add(role.id, 'Formulário de Allowlist aprovado');
    app.stage = 'awaiting';
    app.reviewerId = reviewerId;
    await this.store.save(app);
  }

  async approveInterview(app: Application, guild: Guild, interviewerId: string) {
    if (app.stage === 'approved') return;
    if (app.stage !== 'awaiting' && app.stage !== 'publishing') throw new UserError('A ficha ainda precisa ser aprovada antes da entrevista.');
    const channel = await this.channel(this.config.resultChannelId);
    const retry = app.stage === 'publishing';
    if (!retry) {
      const candidate = await guild.members.fetch({ user: app.userId, force: true, cache: false });
      if (!channel.permissionsFor(candidate)?.has(PermissionFlagsBits.ViewChannel)) throw new UserError('O candidato precisa ter acesso ao canal de resultado.');
      app.stage = 'publishing';
      app.interviewerId = interviewerId;
      app.resultStartedAt = Date.now();
      await this.store.save(app);
    }
    const candidate = await guild.members.fetch({ user: app.userId, force: true, cache: false });
    if (candidate.roles.cache.has(this.config.waitingRoleId)) await candidate.roles.remove(this.config.waitingRoleId, 'Entrevista de Allowlist aprovada');
    const post = resultCard(app);
    const existing = retry && await findRecent(channel, app.resultStartedAt! - 10_000, message =>
      message.author.id === this.client.user?.id && message.content === post.content && message.embeds[0]?.title === post.embeds[0]?.title);
    const message = existing || await channel.send({ ...post, nonce: `al-f-${app.id}`, enforceNonce: true } satisfies MessageCreateOptions);
    app.resultId = message.id;
    app.stage = 'approved';
    await this.store.save(app);
  }

  async refreshReview(message: Message, app: Application) {
    try { await message.edit(reviewCard(app)); }
    catch (error) { log('allowlist_review_refresh_failed', { channelId: message.channelId, messageId: message.id, code: errorCode(error) }, 'warn'); }
  }
}
