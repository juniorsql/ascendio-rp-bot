import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, StringSelectMenuBuilder, type APIEmbed } from 'discord.js';
import { safeText, UserError } from '../validation/input.js';
import { questions, sections } from './questions.js';
import { resumePage } from './form.js';
import type { Application, Decision } from './store.js';

const gold = 0xb69a60;
const green = 0x51b96e;
const red = 0xcc6670;
const footer = { text: 'Ascendio Roleplay • Allowlist' };
export const silent = { parse: [] as never[] };

function button(action: string, label: string, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(`al:${action}`).setLabel(label).setStyle(style);
}

export function storyButton(app: Application) {
  const url = app.answers['16'];
  return url && url.length <= 512 ? new ButtonBuilder().setLabel('Abrir história').setStyle(ButtonStyle.Link).setURL(url) : undefined;
}

export function panelCard() {
  return {
    embeds: [{
      title: '✨ Seja bem-vindo à Allowlist!',
      color: gold,
      description: 'Você está prestes a dar o primeiro passo no mundo bruxo do Ascendio RP. Queremos conhecer seu jeito de jogar e a história do personagem que você vai trazer para Hogwarts.\n\nResponda com calma. Toque em **Continuar** para avançar e, na última pergunta, cole o link da sua história. Quando terminar, clique em **Enviar para análise**.\n\n**Boa sorte! A gente se vê em Hogwarts.**',
      footer,
    }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button('home', 'Preencher formulário', ButtonStyle.Primary))],
    allowedMentions: silent,
  };
}

export function applicationReady(app?: Application) {
  return Boolean(app?.character && questions.every(question => app.answers[question.id]));
}

export function applicationCard(app: Application | undefined, scheduleChannelId: string, resultChannelId: string, nextPage?: number) {
  const stage = app?.stage ?? 'draft';
  const states = {
    submitting: 'Seu envio ficou pendente. Use o botão abaixo para concluir.',
    review: 'Sua ficha está com a equipe para análise.' + (app?.nicknameApplied === false ? '\nO Discord recusou a atualização do seu apelido neste servidor.' : ''),
    awaiting: `Sua ficha foi aprovada. Envie sua disponibilidade em <#${scheduleChannelId}> para combinar a entrevista.`,
    publishing: 'A equipe concluiu sua avaliação. O resultado está sendo publicado.',
    approved: `Sua entrevista foi aprovada! Confira o resultado em <#${resultChannelId}>.`,
    rejected: `A equipe concluiu sua avaliação e sua candidatura não foi aprovada desta vez. Confira o resultado em <#${resultChannelId}>.`,
  };
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (stage === 'submitting') components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button('send', 'Concluir envio', ButtonStyle.Primary)));
  if (stage !== 'draft') {
    const color = stage === 'approved' ? green : stage === 'rejected' ? red : gold;
    return { embeds: [{ title: '📜 Minha Allowlist', description: states[stage], color, footer }], components, allowedMentions: silent };
  }
  const count = questions.filter(question => app?.answers[question.id] && (question.id !== '16' || app.character)).length;
  const progress = `**${count} de ${questions.length} respostas salvas**`;
  const feedback = app?.feedback ? `\n\n**Ajustes solicitados pela equipe**\n${safeText(app.feedback)}` : '';
  const ready = nextPage === undefined && applicationReady(app);
  const description = progress + (ready ? '\nSua ficha está pronta para análise.' : '') + feedback;
  const page = nextPage ?? (app?.feedback ? 0 : resumePage(app));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(ready
    ? button('send', 'Enviar para análise', ButtonStyle.Success)
    : button(`page-v3:${page}`, count ? 'Continuar' : 'Começar', ButtonStyle.Primary));
  if (ready || page > 0) row.addComponents(button('page-v3:0', 'Revisar do início'));
  components.push(row);
  return { embeds: [{ title: '📜 Minha Allowlist', description, color: gold, footer }], components, allowedMentions: silent };
}

export function sectionAt(index: string | undefined) {
  if (!index || !/^[0-4]$/.test(index)) throw new UserError('Selecione uma parte válida do formulário.');
  return sections[Number(index)]!;
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
  if (stage === 'approved' || stage === 'rejected') controls.addComponents(
    button(`interview-pass:${key}`, 'Aprovar entrevista e publicar', ButtonStyle.Success).setDisabled(true),
    button(`reject:${key}`, 'Reprovar e publicar', ButtonStyle.Danger).setDisabled(true),
  );
  if (stage === 'publishing') {
    const action = app.resultDecision === 'rejected' ? 'reject' : 'interview-pass';
    controls.addComponents(button(`${action}:${key}`, 'Concluir publicação', ButtonStyle.Primary));
  }
  const story = storyButton(app);
  if (story) controls.addComponents(story);
  const read = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`al:read:${key}`).setPlaceholder('Ler respostas da ficha')
    .addOptions(sections.map((section, index) => ({ label: section.title, value: String(index) }))));
  const components = stage === 'draft' ? [] : [read, ...(controls.components.length ? [controls] : [])];
  const time = (at: number | undefined) => at ? `<t:${Math.floor(at / 1000)}:f>` : '';
  const record = (label: string, userId: string | undefined, at?: number) =>
    [`**${label}**`, userId && `<@${userId}>`, time(at)].filter(Boolean).join(' · ');
  const audit = [
    app.submittedAt && record('Enviada', undefined, app.submittedAt),
    app.reviewerId && record('Formulário aprovado', app.reviewerId, app.formApprovedAt),
    stage === 'approved' && app.interviewerId && record('Entrevista aprovada', app.interviewerId, app.decidedAt ?? app.resultStartedAt),
    stage === 'rejected' && app.rejectedById && record('Reprovada', app.rejectedById, app.decidedAt ?? app.resultStartedAt),
  ].filter(Boolean);
  const details = [
    `**Jogador** · <@${app.userId}>`,
    `**Personagem** · ${safeText(escapeMarkdown(app.character))}`,
    ...audit,
  ];
  return {
    embeds: [{ title: titles[stage], color: stage === 'approved' ? green : stage === 'rejected' ? red : gold,
      description: details.join('\n'),
      footer: { text: `Ficha ${app.id}` },
    }],
    components, allowedMentions: silent,
  };
}

export function answersCard(app: Application, index: string) {
  const section = sectionAt(index);
  if (index === '4') {
    const url = app.answers['16'];
    const button = storyButton(app);
    return {
      embeds: [{ title: `História de ${safeText(escapeMarkdown(app.character))}`, url, color: gold }],
      components: button ? [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] : [],
      allowedMentions: silent,
    };
  }
  const answers: APIEmbed = { title: section.title, color: gold,
    fields: section.questions.map(q => ({ name: q.label, value: safeText(app.answers[q.id] ?? 'Resposta indisponível') })),
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
