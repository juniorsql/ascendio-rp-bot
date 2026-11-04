import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { validateUrlButtons, type UrlButton } from '../validation/input.js';

export function linkRows(buttons: UrlButton[]) {
  const links = validateUrlButtons(buttons);
  if (!links.length) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...links.map(link => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(link.label).setURL(link.url)))];
}
