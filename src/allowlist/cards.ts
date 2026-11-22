import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, StringSelectMenuBuilder, type APIEmbed } from 'discord.js';
import { form } from '../components/forms.js';
import { safeText, UserError } from '../validation/input.js';
import { answerLimit, hastebin, sections } from './questions.js';
import type { Application } from './store.js';

const gold = 0xb69a60;
const green = 0x51b96e;
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
      description: 'Antes de iniciar sua jornada no mundo bruxo de 1940, queremos conhecer sua compreensão sobre Roleplay, as regras do servidor e o personagem que pretende interpretar.\n\nResponda com suas próprias palavras. Valorizamos a imersão, o respeito e a construção coletiva de histórias.\n\n**Como funciona**\nPreencha as cinco partes. Se a equipe aprovar sua ficha, você receberá o cargo **Aguardando Entrevista** para combinar o horário com a staff.\n\n*Toda grande história começa com um personagem. A sua começa aqui.*',
      footer,
    }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button('home', 'Abrir minha Allowlist', ButtonStyle.Primary))],
    allowedMentions: silent,
  };
}

export function applicationReady(app?: Application) {
  return Boolean(app?.character && sections.every(section => section.questions.every(q => app.answers[q.id])));
}

export function applicationCard(app: Application | undefined, scheduleChannelId: string, resultChannelId: string) {
  const stage = app?.stage ?? 'draft';
  const states = {
    submitting: 'Seu envio ficou pendente. Use o botão abaixo para concluir.',
    review: 'Sua ficha está com a equipe para análise.',
    awaiting: `Sua ficha foi aprovada. Envie sua disponibilidade em <#${scheduleChannelId}> para combinar a entrevista.`,
    publishing: 'A equipe registrou sua aprovação na entrevista. O resultado está sendo publicado.',
    approved: `Sua entrevista foi aprovada! Confira o resultado em <#${resultChannelId}>.`,
  };
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (stage === 'submitting') components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('send', 'Concluir envio', ButtonStyle.Primary)));
  if (stage !== 'draft') return { embeds: [{ title: '📜 Minha Allowlist', description: states[stage], color: stage === 'approved' ? green : gold, footer }], components, allowedMentions: silent };
  const progress = sections.map((section, index) => {
    const complete = section.questions.every(q => app?.answers[q.id]) && (index !== 4 || app?.character);
    return `${complete ? '✅' : '▫️'} ${section.title}`;
  });
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(sections.map((_, index) => button(`section:${index}`, `Parte ${index + 1}`))));
  components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('send', 'Enviar para análise', ButtonStyle.Success).setDisabled(!applicationReady(app))));
  const adjustment = app?.feedback ? `\n\n**Ajustes solicitados pela equipe**\n${safeText(app.feedback)}` : '';
  return { embeds: [{ title: '📜 Minha Allowlist', description: `${progress.join('\n')}\n\nAs respostas ficam salvas a cada parte. Você pode voltar a qualquer momento.${adjustment}`, color: gold, footer }], components, allowedMentions: silent };
}

export function sectionAt(index: string | undefined) {
  if (!index || !/^[0-4]$/.test(index)) throw new UserError('Selecione uma parte válida do formulário.');
  return sections[Number(index)]!;
}

export function sectionCard(index: string) {
  const section = sectionAt(index);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button(`edit:${index}`, 'Responder esta parte', ButtonStyle.Primary), button('home', 'Voltar à ficha'));
  if (index === '4') row.addComponents(new ButtonBuilder().setLabel('Abrir Hastebin').setStyle(ButtonStyle.Link).setURL(hastebin));
  return {
    embeds: [{ title: section.title, color: gold, description: section.questions.map(q => `**${q.label}**\n${q.prompt}`).join('\n\n') }],
    components: [row], allowedMentions: silent,
  };
}

export function answerForm(index: string, app?: Application) {
  const section = sectionAt(index);
  const inputs = section.questions.map(q => ({
    id: q.id, label: q.label, paragraph: q.id !== '16', max: q.id === '16' ? 200 : answerLimit, value: app?.answers[q.id],
    placeholder: q.id === '16' ? 'Cole o link da história salva no Hastebin' : 'Responda à pergunta da parte selecionada',
  }));
  if (index === '4') inputs.unshift({ id: 'character', label: 'Nome completo do personagem', paragraph: false, max: 80, value: app?.character, placeholder: 'Use o mesmo nome que informou na história' });
  return form(`al:save:${index}`, section.title, inputs);
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
  };
  const controls = new ActionRowBuilder<ButtonBuilder>();
  if (stage === 'review') controls.addComponents(
    button(`form-pass:${key}`, 'Aprovar formulário', ButtonStyle.Success),
    button(`adjust:${key}`, 'Pedir ajustes'),
  );
  if (stage === 'awaiting' || stage === 'publishing') controls.addComponents(button(`interview-pass:${key}`, 'Aprovar entrevista e publicar', ButtonStyle.Success));
  const read = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`al:read:${key}`).setPlaceholder('Ler respostas da ficha')
    .addOptions(sections.map((section, index) => ({ label: section.title, value: String(index) }))));
  const components = stage === 'draft' ? [] : [read, ...(controls.components.length ? [controls] : [])];
  const reviewer = app.reviewerId ? `\n**Análise** · <@${app.reviewerId}>` : '';
  const interviewer = app.interviewerId ? `\n**Entrevista** · <@${app.interviewerId}>` : '';
  return {
    embeds: [{ title: titles[stage], color: stage === 'approved' ? green : gold,
      description: `**Jogador** · <@${app.userId}>\n**Personagem** · ${safeText(escapeMarkdown(app.character))}${reviewer}${interviewer}`,
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

export function resultCard(app: Application) {
  return {
    content: `<@${app.userId}>`,
    embeds: [{
      title: '✦ ALLOWLIST APROVADA ✦',
      color: green,
      description: `Sua entrevista foi aprovada! A partir de agora, **${safeText(escapeMarkdown(app.character))}** faz parte da história do Ascendio RP.\n\nQue escolhas vão definir seu caminho no mundo bruxo de 1940? **A próxima cena é sua.**`,
      fields: [
        { name: 'Personagem', value: safeText(escapeMarkdown(app.character)), inline: true },
        { name: 'Jogador', value: `<@${app.userId}>`, inline: true },
      ],
      footer,
    }],
    allowedMentions: { parse: [] as never[], users: [app.userId] },
  };
}
