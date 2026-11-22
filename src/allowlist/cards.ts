import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle, type APIEmbed } from 'discord.js';
import { safeText, UserError } from '../validation/input.js';
import { answerLimit, hastebin, questionAt, questions, sections } from './questions.js';
import type { Application, Decision } from './store.js';

const gold = 0xb69a60;
const green = 0x51b96e;
const red = 0xcc6670;
const footer = { text: 'Ascendio Roleplay • Allowlist' };
export const silent = { parse: [] as never[] };

function button(action: string, label: string, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(`al:${action}`).setLabel(label).setStyle(style);
}

export function panelCard() {
  return {
    embeds: [{
      title: '🪄 ASCENDIO ROLEPLAY | ALLOWLIST',
      color: gold,
      description: 'Antes de iniciar sua jornada no mundo bruxo de 1940, queremos conhecer sua compreensão sobre Roleplay, as regras do servidor e o personagem que pretende interpretar.\n\nResponda às 16 perguntas com suas próprias palavras. Se a equipe aprovar sua ficha, você receberá o cargo **Aguardando Entrevista** para combinar o horário com a staff.\n\n*Toda grande história começa com um personagem. A sua começa aqui.*',
      footer,
    }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button('home', 'Abrir minha Allowlist', ButtonStyle.Primary))],
    allowedMentions: silent,
  };
}

export function applicationReady(app?: Application) {
  return !nextQuestion(app);
}

function answered(id: string, app?: Application) {
  return Boolean(app?.answers[id] && (id !== '16' || app.character));
}

export function nextQuestion(app?: Application) {
  return questions.find(question => !answered(question.id, app));
}

export function applicationCard(app: Application | undefined, scheduleChannelId: string, resultChannelId: string) {
  const stage = app?.stage ?? 'draft';
  const states = {
    submitting: 'Seu envio ficou pendente. Use o botão abaixo para concluir.',
    review: 'Sua ficha está com a equipe para análise.',
    awaiting: `Sua ficha foi aprovada. Envie sua disponibilidade em <#${scheduleChannelId}> para combinar a entrevista.`,
    publishing: 'A equipe concluiu sua avaliação. O resultado está sendo publicado.',
    approved: `Sua entrevista foi aprovada! Confira o resultado em <#${resultChannelId}>.`,
    rejected: `A equipe concluiu sua avaliação e sua candidatura não foi aprovada desta vez. Confira o resultado em <#${resultChannelId}>.`,
  };
  const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  if (stage === 'submitting') components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('send', 'Concluir envio', ButtonStyle.Primary)));
  if (stage !== 'draft') {
    const color = stage === 'approved' ? green : stage === 'rejected' ? red : gold;
    return { embeds: [{ title: '📜 Minha Allowlist', description: states[stage], color, footer }], components, allowedMentions: silent };
  }
  const count = questions.filter(question => answered(question.id, app)).length;
  const next = nextQuestion(app);
  const list = questions.map(question => `${answered(question.id, app) ? '✅ ' : ''}**${question.id}.** ${question.prompt}`).join('\n\n');
  const select = new StringSelectMenuBuilder().setCustomId('al:choose').setPlaceholder('Escolha uma pergunta para responder ou editar')
    .addOptions(questions.map(question => ({ label: question.label, value: question.id, description: answered(question.id, app) ? 'Respondida • Toque para editar' : 'Aguardando resposta' })));
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  const actions = new ActionRowBuilder<ButtonBuilder>();
  if (next) actions.addComponents(button('next', `Responder pergunta ${next.id}`, ButtonStyle.Primary));
  actions.addComponents(
    new ButtonBuilder().setLabel('Abrir Hastebin').setStyle(ButtonStyle.Link).setURL(hastebin),
    button('send', 'Enviar para análise', ButtonStyle.Success).setDisabled(!applicationReady(app)),
  );
  components.push(actions);
  const progress = { name: `${count}/16 respondidas`, value: 'Use o menu abaixo. Cada resposta é salva ao enviar.' };
  const fields = app?.feedback ? [{ name: 'Ajustes solicitados pela equipe', value: safeText(app.feedback) }, progress] : [progress];
  return { embeds: [{ title: '📜 Minha Allowlist', description: list, fields, color: gold, footer }], components, allowedMentions: silent };
}

export function sectionAt(index: string | undefined) {
  if (!index || !/^[0-4]$/.test(index)) throw new UserError('Selecione uma parte válida do formulário.');
  return sections[Number(index)]!;
}

export function answerForm(id: string, app?: Application) {
  const question = questionAt(id);
  const lore = id === '16';
  const modal = new ModalBuilder().setCustomId(`al:save-answer:${id}`).setTitle(`Allowlist • Pergunta ${id}`)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(question.prompt));
  if (lore) {
    const name = new TextInputBuilder().setCustomId('character').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true);
    if (app?.character) name.setValue(app.character);
    modal.addLabelComponents(new LabelBuilder().setLabel('Nome completo do personagem').setTextInputComponent(name));
  }
  const input = new TextInputBuilder().setCustomId(id).setStyle(lore ? TextInputStyle.Short : TextInputStyle.Paragraph)
    .setMaxLength(lore ? 200 : answerLimit).setRequired(true);
  if (lore) input.setPlaceholder('https://www.toptal.com/developers/hastebin/...');
  const value = app?.answers[id];
  if (value) input.setValue(value);
  return modal.addLabelComponents(new LabelBuilder().setLabel(lore ? 'Link da história salva no Hastebin' : 'Sua resposta').setTextInputComponent(input));
}

export function reviewCard(app: Application) {
  const key = `${app.userId}:${app.id}`;
  const stage = app.stage === 'submitting' ? 'review' : app.stage;
  const titles = {
    draft: '🔄 Ficha devolvida para ajustes',
    review: '📚 Ficha aguardando análise',
    awaiting: '📅 Aguardando entrevista',
    publishing: '📜 Publicação do resultado pendente',
    approved: '✅ Entrevista aprovada',
    rejected: '❌ Candidatura reprovada',
  };
  const controls = new ActionRowBuilder<ButtonBuilder>();
  if (stage === 'review') controls.addComponents(
    button(`form-pass:${key}`, 'Aprovar formulário', ButtonStyle.Success),
    button(`adjust:${key}`, 'Pedir ajustes'),
  );
  if (stage === 'awaiting') controls.addComponents(button(`interview-pass:${key}`, 'Aprovar entrevista e publicar', ButtonStyle.Success));
  if (stage === 'review' || stage === 'awaiting') controls.addComponents(button(`reject:${key}`, 'Reprovar e publicar', ButtonStyle.Danger));
  if (stage === 'publishing') {
    const action = app.resultDecision === 'rejected' ? 'reject' : 'interview-pass';
    controls.addComponents(button(`${action}:${key}`, 'Concluir publicação', ButtonStyle.Primary));
  }
  const read = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`al:read:${key}`).setPlaceholder('Ler respostas da ficha')
    .addOptions(sections.map((section, index) => ({ label: section.title, value: String(index) }))));
  const components = stage === 'draft' ? [] : [read, ...(controls.components.length ? [controls] : [])];
  const reviewer = app.reviewerId ? `\n**Análise** · <@${app.reviewerId}>` : '';
  const interviewer = app.interviewerId ? `\n**Entrevista** · <@${app.interviewerId}>` : '';
  const rejection = app.rejectedById ? `\n**Reprovado por** · <@${app.rejectedById}>` : '';
  return {
    embeds: [{ title: titles[stage], color: stage === 'approved' ? green : stage === 'rejected' ? red : gold,
      description: `**Jogador** · <@${app.userId}>\n**Personagem** · ${safeText(escapeMarkdown(app.character))}${reviewer}${interviewer}${rejection}`,
      footer: { text: `Ficha ${app.id}` },
    }],
    components, allowedMentions: silent,
  };
}

export function answersCard(app: Application, index: string) {
  const section = sectionAt(index);
  const description = index === '4' ? `[Ler a história de ${safeText(escapeMarkdown(app.character))} no Hastebin](${app.answers['16']})` : undefined;
  const answers: APIEmbed = { title: section.title, color: gold, description,
    fields: description ? undefined : section.questions.map(q => ({ name: q.label, value: safeText(app.answers[q.id] ?? 'Resposta indisponível') })),
  };
  return { embeds: [answers], allowedMentions: silent };
}

export function resultCard(app: Application, decision: Decision) {
  const approved = decision === 'approved';
  const character = safeText(escapeMarkdown(app.character));
  return {
    content: `<@${app.userId}>`,
    embeds: [{
      title: approved ? '✦ ALLOWLIST APROVADA ✦' : '✦ ALLOWLIST REPROVADA ✦',
      color: approved ? green : red,
      description: approved
        ? `Sua entrevista foi aprovada! A partir de agora, **${character}** faz parte da história do Ascendio RP.\n\nQue escolhas vão definir seu caminho no mundo bruxo de 1940? **A próxima cena é sua.**`
        : 'Sua candidatura não foi aprovada nesta avaliação. Agradecemos pelo tempo que você dedicou à Allowlist e por compartilhar a história do seu personagem com a equipe.',
      fields: [
        { name: 'Personagem', value: character, inline: true },
        { name: 'Jogador', value: `<@${app.userId}>`, inline: true },
      ],
      footer,
    }],
    allowedMentions: { parse: [] as never[], users: [app.userId] },
  };
}
