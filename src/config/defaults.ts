export const kinds = ['comunicado', 'atualizacao', 'spoiler', 'evento', 'manutencao', 'inscricoes', 'regras', 'novidade'] as const;
export type Kind = typeof kinds[number];
export const labels: Record<Kind, string> = {
  comunicado: 'Comunicado oficial', atualizacao: 'Atualização do servidor', spoiler: 'Spoiler',
  evento: 'Evento', manutencao: 'Manutenção', inscricoes: 'Abertura de inscrições',
  regras: 'Regras', novidade: 'Novidades da comunidade',
};
export const palette = { dourado: 0xb49a61, preto: 0x151416, bordo: 0x672d3b, noturno: 0x202f4b, marfim: 0xe9dfc8 };
export interface Template { color: number; footer: string; image: string; thumbnail: string }
export interface Rule { title: string; content: string; official: boolean }
export interface Config {
  name: string; footer: string; logo: string;
  welcomeChannelId: string; logChannelId: string; rulesChannelId: string;
  adminRoleIds: string[]; welcomeTitle: string; welcomeText: string;
  templates: Record<Kind, Template>; rules: Rule[];
}
export function defaults(): Config {
  const footer = 'ASCENDIO RP • Sua história começa aqui.';
  return {
    name: 'Ascendio RP', footer, logo: '', welcomeChannelId: '', logChannelId: '', rulesChannelId: '', adminRoleIds: [],
    welcomeTitle: 'ASCENDIO RP | BOAS-VINDAS',
    welcomeText: 'Uma nova história começa em Hogwarts.\n\nSeja bem-vindo(a), {membro}.\n\nAntes de iniciar sua jornada no {servidor}, conheça {regras} e a ambientação da comunidade. Prepare-se para construir a história do seu personagem.',
    templates: Object.fromEntries(kinds.map((kind, i) => [kind, { color: [palette.dourado, palette.noturno, palette.bordo][i % 3]!, footer: '', image: '', thumbnail: '' }])) as Record<Kind, Template>,
    rules: ['Regras gerais', 'Conduta e respeito', 'Metagaming', 'Powergaming', 'Fear RP', 'Combat Logging', 'Criação de personagens', 'Interação e combate mágico'].map(title => ({
      title, official: false,
      content: `EXEMPLO — ${title}: espaço reservado para a administração definir o conteúdo oficial. Este texto demonstra a organização do regulamento e não estabelece uma regra do Ascendio RP.`,
    })),
  };
}
