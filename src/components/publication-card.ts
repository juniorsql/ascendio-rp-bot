import { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, SeparatorBuilder, TextDisplayBuilder, ThumbnailBuilder, type APIEmbed } from 'discord.js';
import { imageUrl, safeText, UserError, validateEmbeds } from '../validation/input.js';

export function publicationCard(embeds: APIEmbed[], imagePosition: 'top' | 'bottom', surroundingText = '') {
  if (embeds.length !== 1) throw new UserError('Escolha a posição da imagem em uma publicação individual.');
  validateEmbeds(embeds);
  const embed = embeds[0]!;
  const title = embed.title ? `## ${safeText(embed.title).replace(/\r?\n/g, ' ')}` : '';
  const body = [embed.description ? safeText(embed.description) : '', ...(embed.fields ?? []).map(f => `**${safeText(f.name)}**\n${safeText(f.value)}`)].filter(Boolean).join('\n\n');
  if (!title && !body) throw new UserError('A publicação precisa de título ou conteúdo.');
  if (title.length + body.length + surroundingText.length > 4000) throw new UserError('Imagem no topo: título, conteúdo e campos precisam caber em 4000 caracteres, incluindo a prévia. Reduza o texto para usar esse layout.');
  const card = new ContainerBuilder().setAccentColor(embed.color ?? 0xb49a61);
  const addImage = () => { if (embed.image?.url) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl(embed.image.url)))); };
  if (imagePosition === 'top') addImage();
  if (title) {
    const heading = new TextDisplayBuilder().setContent(title);
    if (embed.thumbnail?.url) card.addSectionComponents(new SectionBuilder().addTextDisplayComponents(heading).setThumbnailAccessory(new ThumbnailBuilder().setURL(imageUrl(embed.thumbnail.url))));
    else card.addTextDisplayComponents(heading);
  }
  if (title && body) card.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  if (body) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  if (imagePosition === 'bottom') addImage();
  return card;
}
