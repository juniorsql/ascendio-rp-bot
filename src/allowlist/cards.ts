import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, type APIEmbed } from 'discord.js';
import { safeText, UserError } from '../validation/input.js';
import { questions, sections } from './questions.js';
import { resumePage } from './form.js';
import { allowlistAttemptLimit, attemptNumber, retriesRemaining, type Application, type Decision } from './store.js';

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

function rejectionDetails(app: Application) {
  const remaining = retriesRemaining(app);
  if (remaining === 0) return `Você usou as **${allowlistAttemptLimit} tentativas** da Allowlist. Se precisar de orientação, fale com a staff.`;
  return remaining === 1
    ? 'Você ainda tem **1 chance** de refazer a Allowlist.'
    : `Você ainda tem **${remaining} chances** de refazer a Allowlist.`;
}

export function rejectionNotice(app: Application, resultUrl: string, panelUrl: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ver resultado').setURL(resultUrl),
  );
  if (retriesRemaining(app) > 0) row.addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Abrir painel da Allowlist').setURL(panelUrl),
  );
  return {
    content: '**Sua candidatura no Ascendio RP foi reprovada.**\n\nAgradecemos por participar da avaliação. ' + rejectionDetails(app)
      + (retriesRemaining(app) > 0 ? ' Abra o painel e escolha **Refazer Allowlist** para começar uma nova ficha.' : ''),
    components: [row],
    allowedMentions: silent,
  };
}

export function applicationCard(app: Application | undefined, scheduleChannelId: string, resultChannelId: string, nextPage?: number) {
  const stage = app?.stage ?? 'draft';
  const pageSuffix = app ? `:${app.id}` : '';
  const states = {
    submitting: 'Seu envio ficou pendente. Use o botão abaixo para concluir.',
    review: 'Sua ficha está com a equipe para análise.' + (app?.nicknameApplied === false ? '\nO Discord recusou a atualização do seu apelido neste servidor.' : ''),
    awaiting: `Sua ficha foi aprovada. Envie sua disponibilidade em <#${scheduleChannelId}> para combinar a entrevista.`,
    publishing: 'A equipe concluiu sua avaliação. O resultado está sendo publicado.',
    approved: `Sua entrevista foi aprovada! Confira o resultado em <#${resultChannelId}>.`,
    rejected: `A equipe concluiu sua avaliação e sua candidatura não foi aprovada desta vez. Confira o resultado em <#${resultChannelId}>.`,
  };
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (stage === 'submitting') components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button(`send${pageSuffix}`, 'Concluir envio', ButtonStyle.Primary)));
  if (stage !== 'draft') {
    const color = stage === 'approved' ? green : stage === 'rejected' ? red : gold;
    let description = states[stage];
    if (app?.stage === 'rejected') {
      description += `\n\n${rejectionDetails(app)}`;
      if (retriesRemaining(app) > 0) components.push(new ActionRowBuilder<ButtonBuilder>()
        .addComponents(button(`retry:${app.id}`, 'Refazer Allowlist', ButtonStyle.Primary)));
    }
    return { embeds: [{ title: '📜 Minha Allowlist', description, color, footer }], components, allowedMentions: silent };
  }
  const count = questions.filter(question => app?.answers[question.id] && (question.id !== '16' || app.character)).length;
  const progress = `**${count} de ${questions.length} respostas salvas**`;
  const feedback = app?.feedback ? `\n\n**Ajustes solicitados pela equipe**\n${safeText(app.feedback)}` : '';
  const ready = nextPage === undefined && applicationReady(app);
  const attempt = app?.previousAttempts?.length ? `**Tentativa ${attemptNumber(app)} de ${allowlistAttemptLimit}**\n` : '';
  const description = attempt + progress + (ready ? '\nSua ficha está pronta para análise.' : '') + feedback;
  const page = nextPage ?? (app?.feedback ? 0 : resumePage(app));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(ready
    ? button(`send${pageSuffix}`, 'Enviar para análise', ButtonStyle.Success)
    : button(`page-v3:${page}${pageSuffix}`, count ? 'Continuar' : 'Começar', ButtonStyle.Primary));
  if (ready || page > 0) row.addComponents(button(`page-v3:0${pageSuffix}`, 'Revisar do início'));
  components.push(row);
  return { embeds: [{ title: '📜 Minha Allowlist', description, color: gold, footer }], components, allowedMentions: silent };
}

export function sectionAt(index: string | undefined) {
  if (!index || !/^[0-4]$/.test(index)) throw new UserError('Selecione uma parte válida do formulário.');
  return sections[Number(index)]!;
}

export function reviewCard(app: Application, page?: number) {
  const key = `${app.userId}:${app.id}`;
  const action = (name: string) => page === undefined ? `${name}:${key}` : `q-${name}:${key}:${page}`;
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
    button(action('form-pass'), 'Aprovar formulário', ButtonStyle.Success),
    button(action('adjust'), 'Pedir ajustes'),
  );
  if (stage === 'awaiting') controls.addComponents(button(action('interview-pass'), 'Aprovar entrevista e publicar', ButtonStyle.Success));
  if (stage === 'awaiting' && app.formApprovalResultId === null) controls.addComponents(
    button(action('form-pass'), 'Publicar aprovação do formulário', ButtonStyle.Primary),
  );
  if (stage === 'review' || stage === 'awaiting') controls.addComponents(button(action('reject'), 'Reprovar e publicar', ButtonStyle.Danger));
  if (stage === 'approved' || stage === 'rejected') controls.addComponents(
    button(action('interview-pass'), 'Aprovar entrevista e publicar', ButtonStyle.Success).setDisabled(true),
    button(action('reject'), 'Reprovar e publicar', ButtonStyle.Danger).setDisabled(true),
  );
  if (stage === 'publishing') {
    const decision = app.resultDecision === 'rejected' ? 'reject' : 'interview-pass';
    controls.addComponents(button(action(decision), 'Concluir publicação', ButtonStyle.Primary));
  }
  const story = storyButton(app);
  if (story) controls.addComponents(story);
  const read = new ActionRowBuilder<ButtonBuilder>().addComponents(button(`q-open:${key}:0`, 'Abrir ficha', ButtonStyle.Primary));
  const components = stage === 'draft'
    ? (page === undefined ? [] : (story ? [new ActionRowBuilder<ButtonBuilder>().addComponents(story)] : []))
    : [...(page === undefined ? [read] : []), ...(controls.components.length ? [controls] : [])];
  const time = (at: number | undefined) => at ? `<t:${Math.floor(at / 1000)}:f>` : '';
  const record = (label: string, userId: string | undefined, at?: number) =>
    [`**${label}**`, userId && `<@${userId}>`, time(at)].filter(Boolean).join(' · ');
  const audit = [
    app.submittedAt && record('Enviada', undefined, app.submittedAt),
    app.reviewerId && record('Formulário aprovado por', app.reviewerId, app.formApprovedAt),
    stage === 'approved' && app.interviewerId && record('Entrevista aprovada por', app.interviewerId, app.decidedAt ?? app.resultStartedAt),
    stage === 'rejected' && app.rejectedById && record('Reprovada', app.rejectedById, app.decidedAt ?? app.resultStartedAt),
  ].filter(Boolean);
  const details = [
    `**Jogador** · <@${app.userId}>`,
    `**Personagem** · ${safeText(escapeMarkdown(app.character))}`,
    `**Tentativa** · ${attemptNumber(app)} de ${allowlistAttemptLimit}`,
    ...audit,
    ...(stage === 'awaiting' && app.formApprovalResultId === null ? ['A publicação da aprovação no canal de resultados está pendente.'] : []),
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
        ...(approved && app.interviewerId ? [{ name: 'Aprovado por', value: `<@${app.interviewerId}>`, inline: true }] : []),
      ],
      footer,
    }],
    allowedMentions: { parse: [] as never[], users: [app.userId] },
  };
}

export function formApprovalResultCard(app: Application, scheduleChannelId: string) {
  return {
    content: `<@${app.userId}>`,
    embeds: [{
      title: '✦ FORMULÁRIO APROVADO ✦',
      description: `Parabéns! Seu formulário da Allowlist foi aprovado. Você recebeu o cargo **Aguardando Entrevista**.\n\nFique de olho em <#${scheduleChannelId}> e envie sua disponibilidade para combinar o horário com a staff.`,
      color: gold,
      fields: [
        { name: 'Personagem', value: safeText(escapeMarkdown(app.character)) },
        ...(app.reviewerId ? [{ name: 'Aprovado por', value: `<@${app.reviewerId}>`, inline: true }] : []),
      ],
      footer: { text: `${footer.text} • Ficha ${app.id}` },
    }],
    allowedMentions: { parse: [] as never[], users: [app.userId] },
  };
}
