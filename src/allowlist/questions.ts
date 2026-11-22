import { UserError } from '../validation/input.js';

export const answerLimit = 800;
export const loreLinkLimit = 2048;

export interface Question {
  id: string;
  label: string;
  prompt: string;
}

export interface Section {
  title: string;
  questions: readonly Question[];
}

export const sections: readonly Section[] = [
  {
    title: 'I · Interpretação e conhecimentos de RP',
    questions: [
      { id: '1', label: '1. Conhecimento do jogador e do personagem', prompt: 'Você conhece profundamente o universo de Harry Potter, mas seu personagem está apenas começando seus estudos em Hogwarts. Como diferenciaria o seu conhecimento como jogador daquilo que seu personagem realmente sabe?' },
      { id: '2', label: '2. Derrota em um duelo', prompt: 'Durante um duelo, seu personagem acaba sendo derrotado por outro bruxo. Como você interpretaria essa derrota e suas consequências, mesmo que desejasse que seu personagem tivesse vencido?' },
      { id: '3', label: '3. Experiência do professor', prompt: 'Durante uma aula, seu personagem acredita saber mais sobre determinado assunto do que o professor. Como você interpretaria essa situação, considerando a experiência do professor e os limites de conhecimento do seu personagem?' },
      { id: '4', label: '4. Conflito entre dois bruxos', prompt: 'Seu personagem presencia uma discussão entre dois bruxos, mas não conhece os motivos do conflito. Como você decidiria se ele deve interferir, observar ou procurar ajuda?' },
      { id: '5', label: '5. Reconhecimento e prestígio', prompt: 'Imagine que seu personagem deseja conquistar reconhecimento e prestígio no mundo bruxo. Como você desenvolveria essa trajetória de maneira natural, sem exigir que outros personagens reconheçam sua importância?' },
    ],
  },
  {
    title: 'II · Regras do Ascendio RP',
    questions: [
      { id: '6', label: '6. Exploração da Floresta Proibida', prompt: 'Um estudante deseja explorar a Floresta Proibida durante a noite, sem autorização ou acompanhamento. Essa atitude é permitida pelas regras de Hogwarts? Explique.' },
      { id: '7', label: '7. Informação descoberta fora do RP', prompt: 'Você descobre, por meio de uma conversa fora do RP, um segredo importante sobre outro personagem. Como deve agir em relação a essa informação dentro do jogo?' },
      { id: '8', label: '8. Obtenção de habilidades raras', prompt: 'Seu personagem deseja possuir uma habilidade rara, como Animagia, Legilimência ou um vínculo especial com uma criatura extraordinária. Como funciona a obtenção dessas habilidades no Ascendio RP?' },
    ],
  },
  {
    title: 'III · Ambientação e mundo bruxo (1940)',
    questions: [
      { id: '9', label: '9. Como interpretar na década de 1940', prompt: 'O Ascendio RP se passa em 1940. Como você pretende adaptar os costumes, conhecimentos e comportamentos do seu personagem à época?' },
      { id: '10', label: '10. Notícias do Profeta Diário', prompt: 'O Profeta Diário tem divulgado notícias sobre ataques misteriosos e o aumento da insegurança no mundo bruxo. Como esses acontecimentos poderiam influenciar a rotina e as decisões do seu personagem?' },
      { id: '11', label: '11. Tensões envolvendo Grindelwald', prompt: 'Em meio às tensões envolvendo Gellert Grindelwald e seus ideais, qual seria a opinião do seu personagem sobre os acontecimentos que ameaçam a comunidade bruxa? Como isso poderia influenciar suas relações com outros personagens?' },
      { id: '12', label: '12. Rumores na Floresta Proibida', prompt: 'Seu personagem ouve rumores sobre acontecimentos estranhos na Floresta Proibida. Ele investigaria, procuraria ajuda ou evitaria o local? Explique sua escolha considerando sua personalidade e suas limitações.' },
    ],
  },
  {
    title: 'IV · Expectativas e experiências',
    questions: [
      { id: '13', label: '13. O que espera viver no Ascendio RP', prompt: 'O que mais desperta seu interesse no Ascendio RP? Quais histórias, atividades ou experiências você espera vivenciar durante sua jornada no mundo bruxo?' },
      { id: '14', label: '14. Experiências anteriores com RP', prompt: 'Considerando suas experiências anteriores em jogos e comunidades de RP, quais situações já fizeram você perder o interesse, sentir-se desmotivado ou deixar de aproveitar uma história como gostaria?' },
      { id: '15', label: '15. Sua contribuição à comunidade', prompt: 'O Roleplay é uma experiência construída por todos. De que maneira você acredita que pode contribuir para tornar o Ascendio RP um ambiente divertido, respeitoso e envolvente para os demais jogadores?' },
    ],
  },
  {
    title: 'V · História do personagem',
    questions: [
      { id: '16', label: '16. Link da história no Hastebin', prompt: 'Conte a história do personagem que pretende interpretar. Apresente nome, idade, origem, família, personalidade, qualidades, defeitos, acontecimentos marcantes, objetivos e motivações. Explique como ele se encaixa em 1940 e o que o levou à região de Hogwarts. Habilidades especiais e vínculos extraordinários dependem de aprovação da equipe.\n\nEscreva a história no Hastebin, salve e cole o link do texto salvo no formulário.' },
    ],
  },
];

export const questions = sections.flatMap(section => section.questions);

export const shortQuestions = [
  ['O que seu personagem realmente sabe?', 'Você conhece Harry Potter, mas ele acaba de chegar a Hogwarts. Como separa os conhecimentos?'],
  ['Como você interpretaria uma derrota?', 'Seu personagem perdeu um duelo que você queria vencer. Como ele lida com as consequências?'],
  ['Como reagiria ao discordar do professor?', 'Seu personagem acha que sabe mais. Considere a experiência do professor e seus próprios limites.'],
  ['Como reagiria a uma discussão?', 'Dois bruxos discutem e seu personagem não sabe por quê. Ele interfere, observa ou pede ajuda?'],
  ['Como conquistaria reconhecimento?', 'Seu personagem busca prestígio. Como ele o conquista sem exigir reconhecimento dos outros?'],
  ['Pode entrar na Floresta Proibida?', 'Um estudante quer ir à noite, sem autorização nem companhia. O que dizem as regras? Explique.'],
  ['Como lidaria com um segredo fora do RP?', 'Você descobriu um segredo de outro personagem fora do jogo. Como age dentro do RP?'],
  ['Como obteria uma habilidade rara?', 'Como o Ascendio RP aprova Animagia, Legilimência ou vínculos com criaturas extraordinárias?'],
  ['Como seu personagem vive em 1940?', 'Como adaptaria os costumes, conhecimentos e comportamentos do personagem à época?'],
  ['Como reagiria às notícias de ataques?', 'Como os ataques noticiados pelo Profeta Diário afetariam sua rotina e suas decisões?'],
  ['O que pensa sobre Grindelwald?', 'Como as tensões no mundo bruxo influenciam sua opinião e suas relações?'],
  ['Como reagiria aos rumores da Floresta?', 'Investigaria, pediria ajuda ou evitaria o local? Considere sua personalidade e seus limites.'],
  ['O que quer viver no Ascendio RP?', 'Quais histórias, atividades ou experiências mais despertam seu interesse?'],
  ['O que já desmotivou você no RP?', 'Pense nas suas experiências em jogos e comunidades. O que atrapalhou sua diversão?'],
  ['Como contribuiria com a comunidade?', 'Como você ajudaria a tornar o RP divertido, respeitoso e envolvente para todos?'],
] as const;

export function questionAt(id: string | undefined): Question {
  const question = questions.find(item => item.id === id);
  if (!question) throw new UserError('Selecione uma pergunta válida da Allowlist.');
  return question;
}

export function loreLink(value: string): string {
  const pasted = value.trim();
  const markdown = /^\[[^\n]+?\]\(\s*(.+?)\s*\)$/.exec(pasted);
  const address = (markdown?.[1] ?? pasted).replace(/^<([^<>]+)>$/, '$1');
  const webAddress = /^[a-z][a-z\d+.-]*:\/\//i.test(address) ? address : `https://${address.replace(/^\/\//, '')}`;
  try {
    const url = new URL(webAddress);
    if (address && !/\s/.test(address) && ['https:', 'http:'].includes(url.protocol)
      && url.hostname.includes('.') && !url.username && !url.password && url.href.length <= loreLinkLimit) {
      return url.href;
    }
  } catch {
    // Uma entrada que não se parece com URL usa a mesma orientação.
  }
  throw new UserError('Pergunta 16: cole o endereço da história, como o link copiado ao compartilhar o documento.');
}
