import { MessageFlags, type ButtonInteraction, type Interaction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { form } from '../components/forms.js';
import { snowflake, text, UserError } from '../validation/input.js';
import { answerForm, answersCard, applicationCard, sectionAt, sectionCard, silent } from './cards.js';
import { answerLimit, loreLink } from './questions.js';
import type { Allowlist } from './service.js';
import { newApplication } from './store.js';

type Component = ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;

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
    const app = await allowlist.store.get(userId);
    if (app?.id !== applicationId || app.reviewId !== message.id || app.stage === 'draft') throw new UserError('Esta ficha já foi atualizada. Use o card mais recente.');
    if (action === 'read' && i.isStringSelectMenu()) return i.editReply(answersCard(app, i.values[0] ?? ''));
    let confirmation: string;
    if (action === 'form-pass' && i.isButton()) {
      await allowlist.approveForm(app, guild, i.user.id);
      confirmation = `Formulário aprovado. O candidato pode combinar o horário em <#${allowlist.config.scheduleChannelId}>.`;
    } else if (action === 'interview-pass' && i.isButton()) {
      await allowlist.approveInterview(app, guild, i.user.id);
      confirmation = `Entrevista aprovada. [Abrir o resultado](https://discord.com/channels/${allowlist.guildId}/${allowlist.config.resultChannelId}/${app.resultId})`;
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
  const dashboard = async () => applicationCard(await store.get(i.user.id), config.scheduleChannelId, config.resultChannelId);
  if (i.isChatInputCommand()) return i.reply({ ...await dashboard(), flags: MessageFlags.Ephemeral });
  if (!i.isButton() && !i.isModalSubmit() && !i.isStringSelectMenu()) return;
  const [, action, key, appId] = i.customId.split(':');
  if (['read', 'form-pass', 'interview-pass', 'adjust', 'adjust-save'].includes(action ?? '')) {
    return staffAction(i, allowlist, action!, snowflake(key ?? ''), appId ?? '');
  }
  if (action === 'home' && i.isButton()) {
    const view = await dashboard();
    return i.channelId === config.panelChannelId && !i.message.flags.has(MessageFlags.Ephemeral)
      ? i.reply({ ...view, flags: MessageFlags.Ephemeral })
      : i.update({ content: null, ...view });
  }
  if (action === 'section' && i.isButton()) return i.update({ content: null, ...sectionCard(key ?? '') });
  if (action === 'edit' && i.isButton()) {
    const app = await store.get(i.user.id);
    if (app && app.stage !== 'draft') throw new UserError('Sua ficha já foi enviada. Consulte o status no painel.');
    return i.showModal(answerForm(key ?? '', app));
  }
  if (action === 'save' && i.isModalSubmit()) {
    const section = sectionAt(key);
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await store.run(i.user.id, async () => {
      const app = await store.get(i.user.id) ?? newApplication(i.user.id);
      if (app.stage !== 'draft') throw new UserError('Sua ficha já foi enviada. Consulte o status no painel.');
      if (key === '4') app.character = text(i.fields.getTextInputValue('character'), 80, 'Nome do personagem');
      for (const q of section.questions) {
        const value = i.fields.getTextInputValue(q.id);
        app.answers[q.id] = q.id === '16' ? loreLink(value) : text(value, answerLimit, q.label);
      }
      await store.save(app);
    });
    return i.editReply({ content: 'Parte salva.', ...await dashboard() });
  }
  if (action === 'send' && i.isButton()) {
    await i.deferUpdate();
    await store.run(i.user.id, async () => {
      const app = await store.get(i.user.id);
      if (!app) throw new UserError('Responda às cinco partes antes de enviar.');
      await allowlist.submit(app);
    });
    return i.editReply({ content: null, ...await dashboard() });
  }
  throw new UserError('Ação da Allowlist inválida.');
}
