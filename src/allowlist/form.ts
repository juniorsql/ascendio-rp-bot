import { LabelBuilder, ModalBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { text, UserError } from '../validation/input.js';
import { answerLimit, loreLink, questions, type Question } from './questions.js';
import type { Application } from './store.js';

const legacyBlocks = [
  questions.slice(0, 3), questions.slice(3, 6), questions.slice(6, 9), questions.slice(9, 12), questions.slice(12),
];
const fieldId = (index: number) => `questions-${index + 1}`;
const heading = (question: Question) => `${question.id}. ${question.prompt}\n`;

const questionsPerPage = 2;
export const pageCount = Math.ceil(questions.length / questionsPerPage);

export function pageQuestions(page: number) {
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) throw new UserError('Página inválida da Allowlist.');
  const start = page * questionsPerPage;
  return questions.slice(start, start + questionsPerPage);
}

export function resumePage(app?: Application) {
  const missing = questions.findIndex(question => !app?.answers[question.id] || (question.id === '16' && !app.character));
  return missing < 0 ? pageCount - 1 : Math.floor(missing / questionsPerPage);
}

function inputLabel(id: string, label: string, value: string | undefined, max: number, style: TextInputStyle, placeholder: string) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setMaxLength(max).setRequired(true).setPlaceholder(placeholder);
  if (value) input.setValue(value);
  return new LabelBuilder().setLabel(label).setTextInputComponent(input);
}

export function allowlistForm(page: number, app?: Application) {
  const modal = new ModalBuilder().setCustomId(`al:answers:${page}`).setTitle(`Allowlist • ${page + 1} de ${pageCount}`);
  for (const question of pageQuestions(page)) {
    const lore = question.id === '16';
    if (lore) modal.addLabelComponents(inputLabel('character', 'Nome do personagem', app?.character, 80, TextInputStyle.Short, 'Nome completo do personagem'));
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${question.id}.** ${question.prompt}`));
    modal.addLabelComponents(lore
      ? inputLabel(question.id, 'Link da história no Hastebin', app?.answers[question.id], 200, TextInputStyle.Short, 'Cole o link da história salva')
        .setDescription('Após salvar, use “Enviar para análise” na próxima mensagem.')
      : inputLabel(question.id, 'Sua resposta', app?.answers[question.id], answerLimit, TextInputStyle.Paragraph, 'Escreva sua resposta aqui'));
  }
  if (page < pageCount - 1) {
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# O botão Enviar salva seu rascunho. Depois, toque em Continuar.'));
  }
  return modal;
}

export function readLegacyForm(getValue: (id: string) => string): string[] {
  return legacyBlocks.map((_, index) => getValue(fieldId(index)).replaceAll('\r\n', '\n'));
}

function legacyEntries(values: readonly string[], tolerateMissing: boolean) {
  const entries: Array<{ question: Question; answer: string }> = [];
  for (const [index, block] of legacyBlocks.entries()) {
    const value = values[index]?.trimStart() ?? '';
    const bordered = `\n${value}`;
    for (const [offset, question] of block.entries()) {
      const title = heading(question);
      const start = bordered.indexOf(`\n${title}`);
      if (start < 0) {
        if (tolerateMissing) continue;
        throw new UserError(`Confira a pergunta ${question.id}. Mantenha os enunciados e escreva no espaço indicado.`);
      }
      const next = block[offset + 1];
      const contentStart = start + title.length;
      const end = next ? value.indexOf(`\n${heading(next)}`, contentStart) : value.length;
      if (end < 0) {
        if (tolerateMissing) continue;
        throw new UserError(`O enunciado da pergunta ${next!.id} foi alterado. Confira o formulário.`);
      }
      entries.push({ question, answer: value.slice(contentStart, end).trim() });
    }
  }
  return entries;
}

function legacyAnswer(question: Question, answer: string) {
  return text(answer.replace(/^Resposta:[ \t]*/, ''), answerLimit, `Pergunta ${question.id}`);
}

function legacyLore(answer: string) {
  const lore = /^Nome do personagem:[ \t]*(.*?)\n\s*Link da história:\s*(.*)$/s.exec(answer);
  if (!lore) throw new UserError('Pergunta 16: preencha o nome do personagem e o link da história no Hastebin.');
  return { character: text(lore[1] ?? '', 80, 'Nome do personagem'), answer: loreLink(lore[2] ?? '') };
}

export function parseLegacyForm(values: readonly string[]): Pick<Application, 'answers' | 'character'> {
  const answers: Record<string, string> = {};
  let character = '';
  for (const { question, answer } of legacyEntries(values, false)) {
    if (question.id === '16') {
      const lore = legacyLore(answer);
      character = lore.character;
      answers[question.id] = lore.answer;
    } else {
      answers[question.id] = legacyAnswer(question, answer);
    }
  }
  return { answers, character };
}

export function restoreLegacyDraft(app: Application | undefined) {
  if (!app?.formDraft || app.stage !== 'draft') return app;
  for (const { question, answer } of legacyEntries(app.formDraft, true)) {
    if (app.answers[question.id]) continue;
    try {
      if (question.id === '16') {
        const lore = legacyLore(answer);
        app.character ||= lore.character;
        app.answers[question.id] = lore.answer;
      } else {
        app.answers[question.id] = legacyAnswer(question, answer);
      }
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
    }
  }
  return app;
}
