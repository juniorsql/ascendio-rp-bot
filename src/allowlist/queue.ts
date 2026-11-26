import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, type APIEmbed } from 'discord.js';
import { safeText, UserError } from '../validation/input.js';
import { reviewCard, silent } from './cards.js';
import { questions } from './questions.js';
import { attemptNumber, type AllowlistStore, type Application } from './store.js';

const queueSize = 5;
const questionsPerPage = 2;
const readingPages = Math.ceil(questions.length / questionsPerPage);
export type QueueView = 'pending' | 'history';

function button(id: string, label: string, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(`al:${id}`).setLabel(label).setStyle(style);
}

export function queuePanel() {
  return {
    embeds: [{
      title: '📋 Central da Allowlist',
      description: 'Abra a fila para analisar os formulários e acompanhar as entrevistas. No histórico, consulte as fichas concluídas e quem aprovou cada etapa.',
      color: 0xb69a60,
    }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      button('q-list:pending:0', 'Ver fila', ButtonStyle.Primary),
      button('q-list:history:0', 'Histórico'),
    )],
    allowedMentions: silent,
  };
}

const states: Partial<Record<Application['stage'], string>> = {
  review: 'Aguardando análise',
  awaiting: 'Aguardando entrevista',
  publishing: 'Resultado pendente',
  approved: 'Entrevista aprovada',
  rejected: 'Reprovada',
};

function entry(app: Application, attempt: number) {
  return {
    userId: app.userId, id: app.id, character: app.character, stage: app.stage, attempt,
    at: app.submittedAt ?? 0, decidedAt: app.decidedAt ?? 0,
  };
}

export async function queuePage(store: AllowlistStore, view: QueueView, page: number) {
  const ids = await store.userIds();
  const items: ReturnType<typeof entry>[] = [];
  for (let index = 0; index < ids.length; index += 25) {
    const apps = await Promise.all(ids.slice(index, index + 25).map(id => store.get(id)));
    for (const app of apps) {
      if (!app) continue;
      if (view === 'history') {
        app.previousAttempts?.forEach((previous, i) => {
          if (previous.stage === 'approved' || previous.stage === 'rejected') items.push(entry(previous, i + 1));
        });
        if (app.stage === 'approved' || app.stage === 'rejected') items.push(entry(app, attemptNumber(app)));
      } else if (app.reviewId && (app.stage === 'review' || app.stage === 'awaiting' || app.stage === 'publishing')) {
        items.push(entry(app, attemptNumber(app)));
      }
    }
  }
  items.sort((a, b) => (view === 'history' ? b.decidedAt - a.decidedAt : a.at - b.at) || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(items.length / queueSize));
  const current = Math.min(Math.max(0, page), pages - 1);
  const visible = items.slice(current * queueSize, (current + 1) * queueSize);
  const open = new ActionRowBuilder<ButtonBuilder>();
  const description = visible.map((app, i) => {
    open.addComponents(button(`q-open:${app.userId}:${app.id}:0`, `Abrir ficha ${i + 1}`, ButtonStyle.Primary));
    return `**${i + 1}. ${safeText(escapeMarkdown(app.character))}** · <@${app.userId}>\n${states[app.stage]} · Tentativa ${app.attempt}`;
  }).join('\n\n');
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`q-list:${view}:${current - 1}`, 'Anterior').setDisabled(current === 0),
    button(`q-list:${view}:${current + 1}`, 'Próxima').setDisabled(current + 1 >= pages),
    button(`q-list:${view}:${current}`, 'Atualizar'),
    view === 'pending' ? button('q-list:history:0', 'Histórico') : button('q-list:pending:0', 'Ver fila'),
  );
  return {
    content: null,
    embeds: [{
      title: view === 'pending' ? '📋 Fila da Allowlist' : '📚 Histórico da Allowlist',
      description: description || (view === 'pending' ? 'Nenhuma ficha aguardando a equipe.' : 'Nenhuma ficha concluída.'),
      footer: { text: `Página ${current + 1} de ${pages} · ${items.length} ${items.length === 1 ? 'ficha' : 'fichas'}` },
      color: 0xb69a60,
    }],
    components: [...(visible.length ? [open] : []), nav],
    allowedMentions: silent,
  };
}

export function validateReadingPage(page: number) {
  if (!Number.isInteger(page) || page < 0 || page >= readingPages) throw new UserError('Página inválida da ficha.');
  return page;
}

export function staffReading(app: Application, page: number) {
  validateReadingPage(page);
  const { embeds, components } = reviewCard(app, page);
  const start = page * questionsPerPage;
  const story = app.answers['16'];
  const body = questions.slice(start, start + questionsPerPage).map(question => {
    if (question.id === '16' && story) return `**${question.id}. ${question.prompt}**\n${story.length <= 512 ? 'Use o botão **Abrir história**.' : 'Abra o link pelo título desta página.'}`;
    const answer = app.answers[question.id];
    return `**${question.id}. ${question.prompt}**\n${answer ? safeText(escapeMarkdown(answer)) : 'Resposta indisponível.'}`;
  }).join('\n\n');
  const reading: APIEmbed = {
    title: `Perguntas ${start + 1} e ${start + 2} · Página ${page + 1} de ${readingPages}`,
    description: body,
    ...(page === readingPages - 1 && story && story.length > 512 ? { url: story } : {}),
  };
  const key = `${app.userId}:${app.id}`;
  const nav = new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(`q-open:${key}:${page - 1}`, 'Anterior').setDisabled(page === 0),
    button(`q-open:${key}:${page + 1}`, 'Próxima').setDisabled(page + 1 >= readingPages),
    button('q-list:pending:0', 'Ver fila'),
    button('q-list:history:0', 'Histórico'),
  );
  const pages: APIEmbed[] = [...embeds, reading];
  return { content: null, embeds: pages, components: [...components, nav], allowedMentions: silent };
}
