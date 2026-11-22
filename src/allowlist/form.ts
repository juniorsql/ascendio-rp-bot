import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { text, UserError } from '../validation/input.js';
import { answerLimit, loreLink, questions, type Question } from './questions.js';
import type { Application } from './store.js';

const blocks = [
  questions.slice(0, 3), questions.slice(3, 6), questions.slice(6, 9), questions.slice(9, 12), questions.slice(12),
];
const fieldId = (index: number) => `questions-${index + 1}`;
const heading = (question: Question) => `${question.id}. ${question.prompt}\n`;
const nameLabel = 'Nome do personagem:';
const linkLabel = 'Link da história:';

export function allowlistForm(app?: Application) {
  const modal = new ModalBuilder().setCustomId('al:submit-form').setTitle('ASCENDIO ROLEPLAY • ALLOWLIST');
  for (const [index, block] of blocks.entries()) {
    const filled = block.map(question => heading(question) + (question.id === '16'
      ? `${nameLabel} ${app?.character ?? ''}\n${linkLabel} ${app?.answers['16'] ?? ''}`
      : `Resposta: ${app?.answers[question.id] ?? ''}`)).join('\n\n');
    const input = new TextInputBuilder().setCustomId(fieldId(index)).setStyle(TextInputStyle.Paragraph)
      .setRequired(true).setMaxLength(4000).setValue(app?.formDraft?.[index] || filled);
    modal.addLabelComponents(new LabelBuilder()
      .setLabel(`Perguntas ${block[0]!.id} a ${block.at(-1)!.id}`)
      .setDescription(index === blocks.length - 1 ? 'Na pergunta 16, escreva o nome do personagem e cole o link do Hastebin.' : 'Escreva depois de “Resposta:” em cada pergunta.')
      .setTextInputComponent(input));
  }
  return modal;
}

export function readForm(getValue: (id: string) => string): string[] {
  return blocks.map((_, index) => getValue(fieldId(index)).replaceAll('\r\n', '\n'));
}

export function parseForm(values: readonly string[]): Pick<Application, 'answers' | 'character'> {
  const answers: Record<string, string> = {};
  let character = '';
  for (const [index, block] of blocks.entries()) {
    const value = values[index]?.trimStart() ?? '';
    let cursor = 0;
    for (const [offset, question] of block.entries()) {
      const title = heading(question);
      if (!value.startsWith(title, cursor)) {
        throw new UserError(`Confira a pergunta ${question.id}. Mantenha os enunciados e escreva no espaço indicado.`);
      }
      const start = cursor + title.length;
      const next = block[offset + 1];
      const end = next ? value.indexOf(`\n${heading(next)}`, start) : value.length;
      if (end < 0) throw new UserError(`O enunciado da pergunta ${next!.id} foi alterado. Confira o formulário.`);
      const answer = value.slice(start, end).trim();
      if (question.id === '16') {
        const lore = /^Nome do personagem:[ \t]*(.*?)\n\s*Link da história:\s*(.*)$/s.exec(answer);
        if (!lore) throw new UserError('Pergunta 16: preencha o nome do personagem e o link da história no Hastebin.');
        character = text(lore[1] ?? '', 80, 'Nome do personagem');
        answers[question.id] = loreLink(lore[2] ?? '');
      } else {
        answers[question.id] = text(answer.replace(/^Resposta:[ \t]*/, ''), answerLimit, `Pergunta ${question.id}`);
      }
      cursor = end + 1;
    }
  }
  return { answers, character };
}
