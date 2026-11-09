import { ActionRowBuilder, ButtonBuilder, ButtonStyle, FileUploadBuilder, LabelBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { palette } from '../config/defaults.js';
import type { Draft } from '../services/drafts.js';
import { linkRows } from './link-buttons.js';
export interface Input { id: string; label: string; value?: string; max: number; required?: boolean; paragraph?: boolean; placeholder?: string }
export function form(id: string, title: string, inputs: Input[]): ModalBuilder {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(inputs.map(f => {
    const input = new TextInputBuilder().setCustomId(f.id).setLabel(f.label).setStyle(f.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(f.max).setRequired(f.required ?? true);
    if (f.value) input.setValue(f.value);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  }));
}
export function postForm(id: string, draft?: Draft): ModalBuilder {
  return form(id, 'Compor publicação • Ascendio RP', [
    { id: 'title', label: 'Título', max: 256, value: draft?.post?.title },
    { id: 'description', label: 'Conteúdo (Markdown permitido)', max: 4000, paragraph: true, value: draft?.post?.description },
    { id: 'image', label: 'Imagem principal (HTTPS)', max: 2048, required: false, value: draft?.post?.image },
    { id: 'thumbnail', label: 'Miniatura (HTTPS)', max: 2048, required: false, value: draft?.post?.thumbnail },
    { id: 'fields', label: 'Campos: Nome | Valor | sim (um por linha)', max: 2000, required: false, paragraph: true,
      value: draft?.post?.fields.map(f => `${f.name} | ${f.value} | ${f.inline ? 'sim' : 'nao'}`).join('\n') },
  ]);
}
export function controls(draft: Draft) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`confirm:${draft.id}`).setLabel('Publicar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cancel:${draft.id}`).setLabel('Cancelar').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`notify:${draft.id}`).setLabel(draft.notifyEveryone ? 'Desativar @everyone' : 'Ativar @everyone').setStyle(draft.notifyEveryone ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  if (draft.post) row.addComponents(new ButtonBuilder().setCustomId(`edit:${draft.id}`).setLabel('Editar conteúdo').setStyle(ButtonStyle.Primary));
  row.addComponents(new ButtonBuilder().setCustomId(`links:${draft.id}`).setLabel('Botões de URL').setStyle(ButtonStyle.Secondary));
  if (!draft.post) return [row, ...linkRows(draft.links)];
  const theme = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`theme:${draft.id}`).setPlaceholder('Escolher cor temática')
    .addOptions(Object.entries(palette).map(([name, value]) => ({ label: name[0]!.toUpperCase() + name.slice(1), value: String(value) }))));
  const imagePosition = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`layout:${draft.id}`).setPlaceholder('Posição da imagem')
    .addOptions({ label: 'Imagem no topo', value: 'top', description: 'Banner acima do título e do texto', default: draft.post.imagePosition === 'top' },
      { label: 'Imagem embaixo', value: 'bottom', description: 'Imagem após o texto', default: draft.post.imagePosition !== 'top' }));
  const closing = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`closing:${draft.id}`).setLabel(draft.post.closingText ? 'Editar separador final' : 'Separador final').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`video:${draft.id}`).setLabel(draft.video ? 'Editar vídeo' : 'Adicionar vídeo').setStyle(ButtonStyle.Secondary),
  );
  return [row, theme, imagePosition, closing, ...linkRows(draft.links)];
}
export function videoForm(draft: Draft): ModalBuilder {
  const upload = new LabelBuilder().setLabel('Vídeo MP4 de até 15 MB')
    .setFileUploadComponent(new FileUploadBuilder().setCustomId('video').setMinValues(draft.video ? 0 : 1).setMaxValues(1).setRequired(!draft.video));
  if (draft.video) upload.setDescription('Anexe outro arquivo para substituir. Envie vazio para remover.');
  return new ModalBuilder().setCustomId(`video:edit:${draft.id}`).setTitle('Vídeo da publicação').addLabelComponents(upload);
}
export function closingForm(draft: Draft): ModalBuilder {
  return form(`closing:edit:${draft.id}`, 'Separador final', [{ id: 'closing', label: 'Texto após a linha (vazio remove)', max: 1500, required: false, paragraph: true,
    placeholder: 'Escreva aqui o trecho de encerramento da publicação.', value: draft.post?.closingText }]);
}
export function linkForm(draft: Draft): ModalBuilder {
  return form(`links:edit:${draft.id}`, 'Botões de URL', [{ id: 'links', label: 'Nome | https://endereço (um por linha)', max: 3000, required: false, paragraph: true,
    placeholder: 'Discord | https://discord.gg/seu-convite', value: draft.links.map(link => `${link.label} | ${link.url}`).join('\n') }]);
}
