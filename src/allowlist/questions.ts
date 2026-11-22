import { UserError } from '../validation/input.js';

export const hastebin = 'https://www.toptal.com/developers/hastebin';
export const answerLimit = 800;

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

export function loreLink(value: string): string {
  try {
    const url = new URL(value.trim());
    const validHost = url.hostname === 'www.toptal.com' || url.hostname === 'toptal.com';
    const paste = /^\/developers\/hastebin\/(?:raw\/)?([a-zA-Z0-9]{3,80})(?:\.[a-zA-Z0-9]{1,12})?\/?$/.exec(url.pathname);
    if (url.protocol === 'https:' && validHost && !url.port && !url.username && !url.password && paste) {
      return `${hastebin}/${paste[1]}`;
    }
  } catch {
    // O formulário usa a mesma mensagem para endereços inválidos e links incompletos.
  }
  throw new UserError('Questão 16: cole o link do texto salvo no Hastebin da Toptal.');
}
