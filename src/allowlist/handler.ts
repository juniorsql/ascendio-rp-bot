import { MessageFlags, type ButtonInteraction, type Interaction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { form } from '../components/forms.js';
import { snowflake, text, UserError } from '../validation/input.js';
import { answersCard, applicationCard, applicationReady, sectionAt, silent } from './cards.js';
import { allowlistForm, pageCount, pageQuestions, parseLegacyForm, readLegacyForm, restoreLegacyDraft, resumePage } from './form.js';
import { answerLimit, loreLink, questionAt, type Question } from './questions.js';
import type { Allowlist } from './service.js';
import { newApplication, type Application } from './store.js';

type Component = ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;

function requireCurrentAttempt(app: Application | undefined, applicationId?: string) {
  if (applicationId ? app?.id === applicationId : !app?.previousAttempts?.length) return;
  throw new UserError('Este controle pertence a uma ficha anterior. Abra o painel para acessar a ficha atual.');
}

async function submitLegacyForm(i: ModalSubmitInteraction, allowlist: Allowlist) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const { store, config } = allowlist;
  return store.run(i.user.id, async () => {
    const app = await store.get(i.user.id) ?? newApplication(i.user.id);
    if (app.stage !== 'draft') throw new UserError('Sua ficha já foi enviada. Consulte o status pelo painel.');
    requireCurrentAttempt(app);
    const values = readLegacyForm(id => i.fields.getTextInputValue(id));
    try {
      Object.assign(app, parseLegacyForm(values));
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      app.formDraft = values;
      restoreLegacyDraft(app);
      await store.save(app);
      return i.editReply({ content: error.message, ...applicationCard(app, config.scheduleChannelId, config.resultChannelId, resumePage(app)) });
    }
    delete app.formDraft;
    await store.save(app);
    return i.editReply(applicationCard(app, config.scheduleChannelId, config.resultChannelId));
  });
}

async function saveAnswers(i: ModalSubmitInteraction, allowlist: Allowlist, prompts: readonly Question[], page?: number, applicationId?: string) {
  if (i.isFromMessage() && i.message.flags.has(MessageFlags.Ephemeral)) await i.deferUpdate();
  else await i.deferReply({ flags: MessageFlags.Ephemeral });
  const { store, config } = allowlist;
  return store.run(i.user.id, async () => {
    const app = restoreLegacyDraft(await store.get(i.user.id)) ?? newApplication(i.user.id);
    if (app.stage !== 'draft') throw new UserError('Sua ficha já foi enviada. Consulte o status no painel.');
    requireCurrentAttempt(app, applicationId);
    let problem: string | undefined;
    for (const question of prompts) {
      try {
        const value = i.fields.getTextInputValue(question.id);
        if (question.id === '16') {
          app.character = text(i.fields.getTextInputValue('character'), 80, 'Nome do personagem');
          app.answers[question.id] = loreLink(value);
        } else {
          app.answers[question.id] = text(value, answerLimit, question.label);
        }
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        problem ??= error.message;
      }
    }
    await store.save(app);
    let next: number | undefined;
    if (problem) next = page ?? resumePage(app);
    else if (page !== undefined && page < pageCount - 1) next = page + 1;
    else if (!applicationReady(app)) {
      next = resumePage(app);
      if (page === pageCount - 1) problem = 'O link da história foi salvo. Ainda há respostas pendentes. Toque em Continuar para preenchê-las.';
    }
    return i.editReply({ content: problem ?? null, ...applicationCard(app, config.scheduleChannelId, config.resultChannelId, next) });
  });
}

async function staffAction(i: Component, allowlist: Allowlist, action: string, userId: string, applicationId: string) {
  const { guild, message } = i;
  if (!guild || !message || i.channelId !== allowlist.config.reviewChannelId) throw new UserError('Use os controles no canal de análise da Allowlist.');
  const showAdjustment = action === 'adjust' && i.isButton();
  if (!showAdjustment) await i.deferReply({ flags: MessageFlags.Ephemeral });
  await allowlist.requireStaff(guild, i.user.id);
  if (showAdjustment) {
    const app = await allowlist.store.get(userId);
    if (app?.id !== applicationId || app.reviewId !== message.id || app.stage !== 'review') throw new UserError('Esta ficha não está em análise.');
    return i.showModal(form(`al:adjust-save:${userId}:${applicationId}`, 'Pedir ajustes na ficha', [
      { id: 'feedback', label: 'O que precisa ser ajustado?', max: 800, paragraph: true },
    ]));
  }
  return allowlist.store.run(userId, async () => {
    const current = await allowlist.store.get(userId);
    const app = current?.id === applicationId ? current : current?.previousAttempts?.find(previous => previous.id === applicationId);
    if (app?.id !== applicationId || app.reviewId !== message.id || app.stage === 'draft') throw new UserError('Esta ficha já foi atualizada. Use o card mais recente.');
    if (action === 'read' && i.isStringSelectMenu()) return i.editReply(answersCard(app, i.values[0] ?? ''));
    if (app !== current) throw new UserError('O resultado desta ficha já foi publicado.');
    if (app.stage === 'approved' || app.stage === 'rejected') {
      await allowlist.refreshReview(message, app);
      throw new UserError('O resultado desta ficha já foi publicado.');
    }
    let confirmation: string;
    if (action === 'form-pass' && i.isButton()) {
      await allowlist.approveForm(app, guild, i.user.id);
      confirmation = `Formulário aprovado. O candidato pode combinar o horário em <#${allowlist.config.scheduleChannelId}>.`;
      if (app.formApprovalDm === 'failed') confirmation += ' O Discord recusou o envio da mensagem privada.';
    } else if ((action === 'interview-pass' || action === 'reject') && i.isButton()) {
      const decision = action === 'reject' ? 'rejected' : 'approved';
      try {
        await allowlist.publishDecision(app, guild, i.user.id, decision);
      } catch (error) {
        const persisted = await allowlist.store.get(userId);
        if (persisted?.stage === 'publishing') await allowlist.refreshReview(message, persisted);
        throw error;
      }
      const outcome = decision === 'approved' ? 'Entrevista aprovada.' : 'Reprovação publicada.';
      confirmation = `${outcome} [Abrir o resultado](https://discord.com/channels/${allowlist.guildId}/${allowlist.config.resultChannelId}/${app.resultId})`;
      if (app.rejectionDm === 'failed') confirmation += ' O Discord recusou o aviso por mensagem privada.';
    } else if (action === 'adjust-save' && i.isModalSubmit() && app.stage === 'review') {
      app.feedback = text(i.fields.getTextInputValue('feedback'), 800, 'Orientação da equipe');
      app.stage = 'draft';
      await allowlist.store.save(app);
      confirmation = 'Ficha devolvida. A pessoa pode ver a orientação e editar as respostas pelo painel.';
    } else {
      throw new UserError('Esta ação não está disponível para a etapa atual.');
    }
    await allowlist.refreshReview(message, app);
    return i.editReply({ content: confirmation, allowedMentions: silent });
  });
}

export async function allowlistInteraction(i: Interaction, allowlist: Allowlist | undefined) {
  if (!allowlist || !i.guild || i.guildId !== allowlist.guildId) throw new UserError('A Allowlist não está disponível aqui.');
  const { store, config } = allowlist;
  const load = async () => restoreLegacyDraft(await store.get(i.user.id));
  const dashboard = async () => applicationCard(await load(), config.scheduleChannelId, config.resultChannelId);
  if (i.isChatInputCommand()) {
    const app = await load();
    if (!app || (app.stage === 'draft' && !app.feedback && !applicationReady(app))) return i.showModal(allowlistForm(resumePage(app), app));
    return i.reply({ ...applicationCard(app, config.scheduleChannelId, config.resultChannelId, app.feedback ? 0 : undefined), flags: MessageFlags.Ephemeral });
  }
  if (!i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu()) return;
  const [, action, key, appId] = i.customId.split(':');
  if (['read', 'form-pass', 'interview-pass', 'reject', 'adjust', 'adjust-save'].includes(action ?? '')) {
    return staffAction(i, allowlist, action!, snowflake(key ?? ''), appId ?? '');
  }
  if (action === 'home' && i.isButton()) {
    const app = await load();
    if (!app || (app.stage === 'draft' && !app.feedback && !applicationReady(app))) return i.showModal(allowlistForm(resumePage(app), app));
    const view = applicationCard(app, config.scheduleChannelId, config.resultChannelId, app.feedback ? 0 : undefined);
    return i.channelId === config.panelChannelId && !i.message.flags.has(MessageFlags.Ephemeral)
      ? i.reply({ ...view, flags: MessageFlags.Ephemeral })
      : i.update({ content: null, ...view });
  }
  if (action === 'retry' && i.isButton()) {
    await i.deferUpdate();
    const app = await allowlist.startRetry(i.user.id, key);
    return i.editReply({ content: null, ...applicationCard(app, config.scheduleChannelId, config.resultChannelId) });
  }
  if ((i.isButton() && ['page-v3', 'page-v2', 'page', 'form', 'section', 'edit', 'next'].includes(action ?? '')) || (i.isStringSelectMenu() && action === 'choose')) {
    const app = await load();
    if (app && app.stage !== 'draft') return i.update({ content: null, ...applicationCard(app, config.scheduleChannelId, config.resultChannelId) });
    requireCurrentAttempt(app, appId);
    let page = resumePage(app);
    if (action === 'page-v3') page = Number(key);
    else if ((action === 'page' || action === 'page-v2') && key === '0') page = 0;
    return i.showModal(allowlistForm(page, app));
  }
  if (action === 'submit-form' && i.isModalSubmit()) return submitLegacyForm(i, allowlist);
  if (action === 'answers-v3' && i.isModalSubmit()) {
    const page = Number(key);
    return saveAnswers(i, allowlist, pageQuestions(page), page, appId);
  }
  if (action === 'answers-v2' && i.isModalSubmit()) return saveAnswers(i, allowlist, pageQuestions(Number(key), 3));
  if (action === 'answers' && i.isModalSubmit()) return saveAnswers(i, allowlist, pageQuestions(Number(key), 2));
  if ((action === 'save-answer' || action === 'save') && i.isModalSubmit()) {
    const prompts = action === 'save' ? sectionAt(key).questions : [questionAt(key)];
    return saveAnswers(i, allowlist, prompts);
  }
  if (action === 'send' && i.isButton()) {
    await i.deferUpdate();
    await store.run(i.user.id, async () => {
      const app = await load();
      if (!app) throw new UserError('Responda às 16 perguntas antes de enviar.');
      requireCurrentAttempt(app, key);
      await allowlist.submit(app);
    });
    return i.editReply({ content: null, ...await dashboard() });
  }
  throw new UserError('Ação da Allowlist inválida.');
}
