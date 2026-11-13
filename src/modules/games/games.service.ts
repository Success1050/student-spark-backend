import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { OpenAiService } from '../ai/services/openai.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  BattleQuestion,
  ConceptScrambleRound,
  CreateBattleDto,
  GenerateSoloGameDto,
  InviteBattleFriendDto,
  MemoryMatchCard,
  ScholarLadderTier,
  SpeedMathQuestion,
  SubmitSoloScoreDto,
} from './dto/games.dto.js';

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const DEFAULT_MEMORY_PAIRS = [
  {
    term: 'Big-O Notation',
    definition: 'Worst-case asymptotic time/space complexity of an algorithm',
  },
  {
    term: 'Stack Data Structure',
    definition: 'LIFO (Last-In First-Out) collection using push & pop operations',
  },
  {
    term: 'Queue Data Structure',
    definition: 'FIFO (First-In First-Out) linear collection using enqueue & dequeue',
  },
  {
    term: 'Binary Search Tree',
    definition: 'Hierarchical node structure where left child is less than root',
  },
  {
    term: 'Hash Table',
    definition: 'Key-value map computing indices into an array of buckets in O(1)',
  },
  {
    term: 'Recursion',
    definition: 'Method where a function solves a problem by calling copies of itself',
  },
  {
    term: 'Polymorphism',
    definition: 'OOP principle allowing different objects to respond to identical calls',
  },
  {
    term: 'Mitochondria',
    definition: 'The biochemical powerhouse organelle generating cellular ATP energy',
  },
  {
    term: 'Thermodynamics (1st Law)',
    definition: 'Energy cannot be created or destroyed, only transferred or transformed',
  },
  {
    term: 'Ohm’s Law',
    definition: 'Electric current is proportional to voltage and inversely to resistance',
  },
];

const DEFAULT_SCRAMBLE_WORDS: ConceptScrambleRound[] = [
  {
    id: 'scramble-1',
    word: 'ALGORITHM',
    category: 'Computer Science',
    hint: 'A step-by-step procedure or mathematical recipe for solving a problem',
    difficulty: 'EASY',
    maxMistakes: 6,
  },
  {
    id: 'scramble-2',
    word: 'ENCAPSULATION',
    category: 'Object-Oriented Programming',
    hint: 'Bundling data and methods together while hiding internal details',
    difficulty: 'MEDIUM',
    maxMistakes: 6,
  },
  {
    id: 'scramble-3',
    word: 'MITOCHONDRIA',
    category: 'Biological Sciences',
    hint: 'The cellular organelle responsible for generating the majority of ATP energy',
    difficulty: 'MEDIUM',
    maxMistakes: 6,
  },
  {
    id: 'scramble-4',
    word: 'DERIVATIVE',
    category: 'Calculus & Mathematics',
    hint: 'The instantaneous rate of change of a mathematical function with respect to a variable',
    difficulty: 'HARD',
    maxMistakes: 6,
  },
  {
    id: 'scramble-5',
    word: 'EQUILIBRIUM',
    category: 'Physics & Chemistry',
    hint: 'A state in which opposing forces or chemical reaction rates are balanced',
    difficulty: 'MEDIUM',
    maxMistakes: 6,
  },
  {
    id: 'scramble-6',
    word: 'PROBABILITY',
    category: 'Statistics & Math',
    hint: 'A quantitative measure of the likelihood that a particular event will occur',
    difficulty: 'EASY',
    maxMistakes: 6,
  },
  {
    id: 'scramble-7',
    word: 'POLYMORPHISM',
    category: 'Software Engineering',
    hint: 'Ability of distinct classes to define their own specific implementation of a shared method',
    difficulty: 'HARD',
    maxMistakes: 6,
  },
  {
    id: 'scramble-8',
    word: 'RECURSION',
    category: 'Algorithms',
    hint: 'A problem-solving technique where a function calls itself until reaching a base condition',
    difficulty: 'EASY',
    maxMistakes: 6,
  },
];

function generateDynamicMathQuestions(): SpeedMathQuestion[] {
  const questions: SpeedMathQuestion[] = [];
  let idCounter = 1;

  // 1. Multiplication blitz
  for (let i = 0; i < 8; i++) {
    const a = Math.floor(Math.random() * 14) + 6;
    const b = Math.floor(Math.random() * 12) + 3;
    const ans = a * b;
    const distractors = new Set<number>();
    distractors.add(ans + a);
    distractors.add(ans - b);
    distractors.add(ans + (Math.random() > 0.5 ? 4 : -4));
    distractors.delete(ans);
    const options = shuffleArray([
      String(ans),
      ...Array.from(distractors).slice(0, 3).map(String),
    ]);
    questions.push({
      id: `math-${idCounter++}`,
      question: `${a} × ${b} = ?`,
      options,
      correctIndex: options.indexOf(String(ans)),
      category: 'Mental Arithmetic',
    });
  }

  // 2. Square roots & Powers
  const powers = [
    { q: '2⁶ = ?', ans: 64, d: [32, 128, 48] },
    { q: '√225 = ?', ans: 15, d: [13, 25, 17] },
    { q: '3⁴ = ?', ans: 81, d: [27, 243, 64] },
    { q: '√196 = ?', ans: 14, d: [16, 12, 18] },
    { q: '5³ - 25 = ?', ans: 100, d: [125, 75, 150] },
    { q: '√289 = ?', ans: 17, d: [19, 13, 21] },
    { q: '4³ + 16 = ?', ans: 80, d: [64, 48, 96] },
    { q: '√169 + 7 = ?', ans: 20, d: [13, 26, 19] },
  ];
  for (const p of powers) {
    const options = shuffleArray([String(p.ans), ...p.d.map(String)]);
    questions.push({
      id: `math-${idCounter++}`,
      question: p.q,
      options,
      correctIndex: options.indexOf(String(p.ans)),
      category: 'Powers & Roots',
    });
  }

  // 3. Percentages & Pre-algebra
  const preAlgebra = [
    { q: '15% of 200 = ?', ans: 30, d: [20, 25, 35] },
    { q: '25% of 360 = ?', ans: 90, d: [80, 100, 120] },
    { q: 'If 3x + 9 = 24, x = ?', ans: 5, d: [3, 7, 4] },
    { q: 'If 2y - 8 = 16, y = ?', ans: 12, d: [10, 14, 8] },
    { q: 'Derivative of f(x) = 4x² at x = 3 is ?', ans: 24, d: [12, 36, 18] },
    { q: 'Slope of line y = 7x - 12 is ?', ans: 7, d: [-7, 12, -12] },
    { q: 'Area of triangle: base = 12, height = 6', ans: 36, d: [72, 24, 48] },
    { q: '70% of 140 = ?', ans: 98, d: [88, 108, 94] },
  ];
  for (const pa of preAlgebra) {
    const options = shuffleArray([String(pa.ans), ...pa.d.map(String)]);
    questions.push({
      id: `math-${idCounter++}`,
      question: pa.q,
      options,
      correctIndex: options.indexOf(String(pa.ans)),
      category: 'Formulas & Algebra',
    });
  }

  return shuffleArray(questions);
}

export const SCHOLAR_LADDER_TIERS: ScholarLadderTier[] = [
  { level: 1, title: 'Novice Scholar', minXp: 0, maxXp: 49, badge: '📖', perk: 'Arcade Solo Mode', isUnlocked: true, isCurrent: false },
  { level: 2, title: 'Junior Apprentice', minXp: 50, maxXp: 119, badge: '🌱', perk: 'Daily Streak Multiplier', isUnlocked: false, isCurrent: false },
  { level: 3, title: 'Diligent Learner', minXp: 120, maxXp: 219, badge: '🥉', perk: '1v1 Friendly Battle', isUnlocked: false, isCurrent: false },
  { level: 4, title: 'Knowledge Seeker', minXp: 220, maxXp: 349, badge: '🔍', perk: 'Instant Hint Lifelines', isUnlocked: false, isCurrent: false },
  { level: 5, title: 'Concept Explorer', minXp: 350, maxXp: 519, badge: '🧭', perk: 'Custom Room Codes', isUnlocked: false, isCurrent: false },
  { level: 6, title: 'Academic Contender', minXp: 520, maxXp: 719, badge: '⚡', perk: '+10% XP Blitz Boost', isUnlocked: false, isCurrent: false },
  { level: 7, title: 'Logic Master', minXp: 720, maxXp: 969, badge: '🧩', perk: 'Speed Math Hard Tier', isUnlocked: false, isCurrent: false },
  { level: 8, title: 'Honor Roll Adept', minXp: 970, maxXp: 1299, badge: '🎖️', perk: 'Bronze Scholar Frame', isUnlocked: false, isCurrent: false },
  { level: 9, title: 'Senior Quizzer', minXp: 1300, maxXp: 1699, badge: '📚', perk: 'Quick Match Queue', isUnlocked: false, isCurrent: false },
  { level: 10, title: 'Campus Champion', minXp: 1700, maxXp: 2199, badge: '🏆', perk: 'Silver Scholar Shield', isUnlocked: false, isCurrent: false },
  { level: 11, title: 'Master Tactician', minXp: 2200, maxXp: 2799, badge: '🎯', perk: 'Custom Quiz Topics', isUnlocked: false, isCurrent: false },
  { level: 12, title: 'Distinguished Scholar', minXp: 2800, maxXp: 3599, badge: '🌟', perk: 'Gold Laureate Glow', isUnlocked: false, isCurrent: false },
  { level: 13, title: 'Academic Luminary', minXp: 3600, maxXp: 4599, badge: '🔮', perk: 'Referral Commission Booster', isUnlocked: false, isCurrent: false },
  { level: 14, title: 'First-Class Laureate', minXp: 4600, maxXp: 5999, badge: '💎', perk: 'Diamond First-Class Badge', isUnlocked: false, isCurrent: false },
  { level: 15, title: 'Grand Apex Scholar', minXp: 6000, maxXp: 999999, badge: '👑', perk: 'Hall of Fame Permanent Legend', isUnlocked: false, isCurrent: false },
];

export const DEFAULT_BATTLE_QUESTIONS: BattleQuestion[] = [
  {
    id: 'battle-q1',
    question: 'What is the worst-case time complexity of searching an element in a balanced Binary Search Tree (AVL / Red-Black)?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
    correctIndex: 1,
    explanation: 'Balanced BSTs maintain height proportional to log(n), guaranteeing O(log n) worst-case search time.',
    category: 'Computer Science',
  },
  {
    id: 'battle-q2',
    question: 'According to Le Chatelier’s principle, what happens to an exothermic reaction at dynamic equilibrium when temperature rises?',
    options: ['Shifts toward products', 'Shifts toward reactants', 'Rate constant drops to zero', 'Equilibrium remains unaffected'],
    correctIndex: 1,
    explanation: 'Exothermic reactions release heat; increasing temperature acts as adding a product, shifting equilibrium toward reactants.',
    category: 'Chemistry',
  },
  {
    id: 'battle-q3',
    question: 'Which cellular organelle synthesizes ATP through oxidative phosphorylation and contains its own circular mtDNA?',
    options: ['Golgi Complex', 'Mitochondria', 'Endoplasmic Reticulum', 'Lysosome'],
    correctIndex: 1,
    explanation: 'Mitochondria are the primary sites of ATP production in eukaryotic cells and possess their own semi-autonomous circular genome.',
    category: 'Biology',
  },
  {
    id: 'battle-q4',
    question: 'According to Faraday’s Law of Electromagnetic Induction, the induced electromotive force (EMF) is proportional to what rate?',
    options: ['Rate of change of electric current', 'Rate of change of magnetic flux', 'Velocity of the circuit conductor', 'Electrical resistance of the wire'],
    correctIndex: 1,
    explanation: 'Faraday’s law states EMF = -dΦ/dt, directly proportional to the time rate of change of magnetic flux.',
    category: 'Physics',
  },
  {
    id: 'battle-q5',
    question: 'What is the derivative of the natural logarithm function f(x) = ln(x) with respect to x for x > 0?',
    options: ['1/x', 'e^x', 'x ln(x) - x', '1/(x²)'],
    correctIndex: 0,
    explanation: 'The fundamental derivative of the natural log function is d/dx[ln(x)] = 1/x.',
    category: 'Mathematics',
  },
  {
    id: 'battle-q6',
    question: 'In computer networking, which transport layer protocol provides connectionless, low-latency transmission without guaranteed packet ordering?',
    options: ['TCP', 'UDP', 'HTTP/3', 'SCTP'],
    correctIndex: 1,
    explanation: 'UDP (User Datagram Protocol) is a lightweight, connectionless protocol that does not perform handshakes or packet reordering.',
    category: 'Computer Science',
  },
  {
    id: 'battle-q7',
    question: 'What type of chemical bond is formed when two atoms share one or more pairs of valence electrons equally?',
    options: ['Ionic Bond', 'Non-polar Covalent Bond', 'Hydrogen Bond', 'Metallic Bond'],
    correctIndex: 1,
    explanation: 'When electronegativities are similar, electrons are shared equally in non-polar covalent bonds.',
    category: 'Chemistry',
  },
  {
    id: 'battle-q8',
    question: 'During human DNA replication, what enzyme joins Okazaki fragments on the lagging strand by catalyzing phosphodiester bonds?',
    options: ['DNA Helicase', 'DNA Ligase', 'RNA Primase', 'Topoisomerase'],
    correctIndex: 1,
    explanation: 'DNA Ligase seals single-strand nicks between Okazaki fragments during lagging strand synthesis.',
    category: 'Biology',
  },
  {
    id: 'battle-q9',
    question: 'What is the SI unit of electric capacitance?',
    options: ['Henry', 'Farad', 'Tesla', 'Weber'],
    correctIndex: 1,
    explanation: 'Electric capacitance is measured in Farads (F), defined as 1 Coulomb per Volt.',
    category: 'Physics',
  },
  {
    id: 'battle-q10',
    question: 'If the determinant of a square matrix A is equal to zero (det(A) = 0), what does this prove about matrix A?',
    options: ['A is invertible', 'A is singular and has no inverse', 'All eigenvalues are zero', 'A is an identity matrix'],
    correctIndex: 1,
    explanation: 'A matrix with determinant 0 cannot be inverted because 1/det(A) would require division by zero.',
    category: 'Mathematics',
  },
  {
    id: 'battle-q11',
    question: 'Which sorting algorithm has a guaranteed worst-case time complexity of O(n log n) and operates as a divide-and-conquer strategy?',
    options: ['QuickSort', 'MergeSort', 'InsertionSort', 'BubbleSort'],
    correctIndex: 1,
    explanation: 'MergeSort divides arrays into halves and merges them in O(n log n) time in all cases.',
    category: 'Computer Science',
  },
  {
    id: 'battle-q12',
    question: 'What is the pH value of a neutral aqueous solution at standard temperature (25°C)?',
    options: ['0', '7', '14', '1'],
    correctIndex: 1,
    explanation: 'At 25°C, [H+] = [OH-] = 10^-7 M, resulting in -log(10^-7) = 7.',
    category: 'Chemistry',
  },
  {
    id: 'battle-q13',
    question: 'What is the light-dependent process in plants where water molecules split into oxygen, protons, and electrons?',
    options: ['Glycolysis', 'Photolysis', 'Calvin Cycle', 'Krebs Cycle'],
    correctIndex: 1,
    explanation: 'Photolysis occurs in Photosystem II inside thylakoid membranes, generating oxygen from water split by photons.',
    category: 'Biology',
  },
  {
    id: 'battle-q14',
    question: 'What physical law states that pressure applied to an enclosed fluid is transmitted undiminished in all directions?',
    options: ['Bernoulli’s Principle', 'Pascal’s Principle', 'Archimedes’ Principle', 'Hooke’s Law'],
    correctIndex: 1,
    explanation: 'Pascal’s principle governs hydraulic systems, where pressure changes are transmitted equally everywhere in an incompressible fluid.',
    category: 'Physics',
  },
  {
    id: 'battle-q15',
    question: 'What is the integral of cos(x) with respect to x?',
    options: ['-sin(x) + C', 'sin(x) + C', '-cos(x) + C', 'tan(x) + C'],
    correctIndex: 1,
    explanation: 'The indefinite integral of cosine is positive sine: ∫cos(x)dx = sin(x) + C.',
    category: 'Mathematics',
  },
  {
    id: 'battle-q16',
    question: 'Which CPU scheduling algorithm allocates fixed CPU time slices to each process in a cyclic order without priority bias?',
    options: ['Shortest Job First (SJF)', 'Round Robin (RR)', 'First-Come First-Served (FCFS)', 'Multilevel Queue'],
    correctIndex: 1,
    explanation: 'Round Robin assigns each runnable process a fixed time quantum in cyclical FIFO sequence.',
    category: 'Computer Science',
  },
  {
    id: 'battle-q17',
    question: 'Which gas law expresses the combined ideal gas relationship PV = nRT?',
    options: ['Boyle’s Law', 'Charles’s Law', 'Ideal Gas Law', 'Dalton’s Law'],
    correctIndex: 2,
    explanation: 'The Ideal Gas Law combines Boyle’s, Charles’s, and Avogadro’s laws into PV = nRT.',
    category: 'Chemistry',
  },
  {
    id: 'battle-q18',
    question: 'What law of mechanics establishes that every action has an equal and opposite reaction?',
    options: ['Newton’s First Law', 'Newton’s Second Law', 'Newton’s Third Law', 'Kepler’s Third Law'],
    correctIndex: 2,
    explanation: 'Newton’s Third Law states that when one body exerts a force on a second, the second exerts an equal force in the opposite direction.',
    category: 'Physics',
  },
];

export function calculateRank(xp: number): {
  rankLevel: number;
  rankName: string;
  nextRankXp: number;
  badge: string;
  perk: string;
  progressPercent: number;
} {
  const safeXp = Math.max(0, xp || 0);
  for (let i = SCHOLAR_LADDER_TIERS.length - 1; i >= 0; i--) {
    const tier = SCHOLAR_LADDER_TIERS[i];
    if (safeXp >= tier.minXp) {
      const nextTier = SCHOLAR_LADDER_TIERS[i + 1];
      const nextRankXp = nextTier ? nextTier.minXp : tier.minXp + 2000;
      const tierRange = nextRankXp - tier.minXp;
      const progressInTier = safeXp - tier.minXp;
      const progressPercent = Math.min(
        100,
        Math.max(0, Math.round((progressInTier / (tierRange || 1)) * 100)),
      );

      return {
        rankLevel: tier.level,
        rankName: tier.title,
        nextRankXp,
        badge: tier.badge,
        perk: tier.perk,
        progressPercent,
      };
    }
  }

  const first = SCHOLAR_LADDER_TIERS[0];
  return {
    rankLevel: first.level,
    rankName: first.title,
    nextRankXp: 50,
    badge: first.badge,
    perk: first.perk,
    progressPercent: 0,
  };
}

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openaiService: OpenAiService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  /**
   * Resolves a user's real database full name & avatar for 1v1 battle rooms
   */
  async resolveUserProfile(userId?: string, fallbackName?: string, fallbackAvatar?: string) {
    if (fallbackName && fallbackName !== 'Scholar' && fallbackName !== 'Host Scholar' && fallbackName !== 'Challenger') {
      return { fullName: fallbackName, avatarUrl: fallbackAvatar };
    }
    if (!userId || userId === 'guest-player') {
      return { fullName: fallbackName || 'Scholar', avatarUrl: fallbackAvatar };
    }
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, avatarUrl: true, email: true },
      });
      if (user) {
        return {
          fullName: user.fullName || user.email.split('@')[0],
          avatarUrl: user.avatarUrl || fallbackAvatar,
        };
      }
    } catch {}
    return { fullName: fallbackName || 'Scholar', avatarUrl: fallbackAvatar };
  }

  /**
   * Returns Arcade Overview, Mode metadata, and student XP rank
   */
  async getArcadeOverview(userId?: string) {
    let userStats = {
      xpPoints: 0,
      streak: 0,
      longestStreak: 0,
      totalGamesPlayed: 0,
      rank: calculateRank(0),
    };

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          xpPoints: true,
          streak: true,
          longestStreak: true,
        },
      });

      if (user) {
        const gamesCount = await this.prisma.gameMatch.count({
          where: { hostUserId: userId, status: 'COMPLETED' },
        });

        userStats = {
          xpPoints: user.xpPoints,
          streak: user.streak,
          longestStreak: user.longestStreak,
          totalGamesPlayed: gamesCount,
          rank: calculateRank(user.xpPoints),
        };
      }
    }

    const modes = [
      {
        id: 'MEMORY_MATCH',
        title: 'Flashcard Memory Match',
        tagline: 'Flip & Match Academic Concepts',
        description:
          'Match definitions with course terms against the clock to sharpen conceptual memory.',
        icon: 'grid',
        color: '#6366f1',
        xpReward: '25 - 50 XP',
        durationLabel: '90s Sprint',
        type: 'SOLO_BRAIN',
        active: true,
      },
      {
        id: 'CONCEPT_SCRAMBLE',
        title: 'Concept Scramble',
        tagline: 'Academic Hangman & Word Decryption',
        description:
          'Decrypt core academic terminology letter-by-letter with contextual hints before sparks run out.',
        icon: 'key',
        color: '#f59e0b',
        xpReward: '30 - 75 XP',
        durationLabel: '5 Rounds',
        type: 'SOLO_BRAIN',
        active: true,
      },
      {
        id: 'SPEED_MATH',
        title: 'Speed Math & Formulas',
        tagline: '60-Second Rapid-Fire Blitz',
        description:
          'Solve arithmetic, powers, derivatives, and formulas under rapid timer pressure.',
        icon: 'flash',
        color: '#10b981',
        xpReward: '30 - 100 XP',
        durationLabel: '60s Sprint',
        type: 'SOLO_BRAIN',
        active: true,
      },
      {
        id: 'QUIZ_BATTLE_1V1',
        title: '1v1 Live Quiz Battle',
        tagline: 'Real-Time Cross-School Showdown',
        description:
          'Challenge a classmate or match with nationwide students in live synchronous exam duels.',
        icon: 'trophy',
        color: '#ec4899',
        xpReward: '75 - 150 XP',
        durationLabel: 'Live PvP',
        type: 'LIVE_PVP',
        active: true,
      },
      {
        id: 'SCHOLAR_LADDER',
        title: 'First-Class Scholar Ladder',
        tagline: '15-Level Progressive Exam Gauntlet',
        description:
          'Climb the 15-tier academic pyramid with increasing difficulty to earn First-Class badge.',
        icon: 'ribbon',
        color: '#8b5cf6',
        xpReward: '150 - 500 XP',
        durationLabel: '15 Tiers',
        type: 'PROGRESSIVE_LADDER',
        active: true,
      },
    ];

    return {
      success: true,
      userStats,
      modes,
    };
  }

  /**
   * Generates questions and decks for solo brain games
   */
  async generateSoloGame(userId: string, dto: GenerateSoloGameDto) {
    if (dto.mode === 'MEMORY_MATCH') {
      let candidatePairs = [...DEFAULT_MEMORY_PAIRS];
      let noteTitle: string | undefined;

      // Extract from note if noteId provided
      if (dto.noteId) {
        const note = await this.prisma.note.findUnique({
          where: { id: dto.noteId },
          select: { title: true, listsOfTopic: true, summary: true },
        });

        if (note) {
          noteTitle = note.title;

          // 1. Try Dynamic AI Extraction for fresh, non-repetitive pairs
          try {
            const rawContent = `${note.title}. Summary: ${note.summary}. Topics: ${
              Array.isArray(note.listsOfTopic)
                ? (note.listsOfTopic as any[])
                    .map((t) => `${t.topic}: ${t.explanation || ''}`)
                    .join('; ')
                : ''
            }`.substring(0, 3000);

            const aiPrompt = `Generate 6 unique, educational flashcard pairs for a memory match game based on this study note:
"${rawContent}"

Respond ONLY with a valid JSON array of 6 objects, with no markdown code blocks:
[
  { "term": "Short Key Term (< 30 chars)", "definition": "Clear concise explanation (< 90 chars)" }
]`;

            const aiResp = await this.openaiService.chatCompletion({
              userPrompt: aiPrompt,
              temperature: 0.7,
              maxTokens: 500,
            });

            const parsed = JSON.parse(
              aiResp.replace(/```json/g, '').replace(/```/g, '').trim(),
            );
            if (Array.isArray(parsed) && parsed.length >= 4) {
              candidatePairs = parsed.map((p) => ({
                term: String(p.term).slice(0, 35),
                definition: String(p.definition).slice(0, 100),
              }));
            }
          } catch {
            // Procedural fallback from listsOfTopic
            const notePairs: Array<{ term: string; definition: string }> = [];
            if (Array.isArray(note.listsOfTopic)) {
              for (const item of note.listsOfTopic as any[]) {
                if (item?.topic && item?.explanation) {
                  notePairs.push({
                    term: String(item.topic).slice(0, 40),
                    definition: String(item.explanation).slice(0, 110),
                  });
                }
              }
            }
            if (notePairs.length >= 4) {
              candidatePairs = notePairs;
            }
          }
        }
      }

      // Select 6 pairs (12 cards) for a balanced mobile grid
      const chosenPairs = shuffleArray(candidatePairs).slice(0, 6);
      const cards: MemoryMatchCard[] = [];

      chosenPairs.forEach((pair, idx) => {
        const pairId = `pair-${idx + 1}`;
        cards.push({
          id: `card-${idx + 1}-term`,
          pairId,
          type: 'TERM',
          content: pair.term,
        });
        cards.push({
          id: `card-${idx + 1}-def`,
          pairId,
          type: 'DEFINITION',
          content: pair.definition,
        });
      });

      return {
        success: true,
        mode: 'MEMORY_MATCH',
        noteTitle,
        totalPairs: chosenPairs.length,
        timeLimitSeconds: 90,
        cards: shuffleArray(cards),
      };
    }

    if (dto.mode === 'CONCEPT_SCRAMBLE') {
      let scrambleBank = [...DEFAULT_SCRAMBLE_WORDS];
      let noteTitle: string | undefined;

      if (dto.noteId) {
        const note = await this.prisma.note.findUnique({
          where: { id: dto.noteId },
          select: { title: true, listsOfTopic: true, summary: true },
        });
        if (note) {
          noteTitle = note.title;

          // Try Dynamic AI Concept Scramble Generation
          try {
            const rawContent = `${note.title}. Summary: ${note.summary}. Topics: ${
              Array.isArray(note.listsOfTopic)
                ? (note.listsOfTopic as any[])
                    .map((t) => `${t.topic}: ${t.explanation || ''}`)
                    .join('; ')
                : ''
            }`.substring(0, 3000);

            const aiPrompt = `Generate 5 single-word academic concepts (length 4 to 12 uppercase letters only, no spaces or hyphens) with witty educational hints based on this note:
"${rawContent}"

Respond ONLY with a valid JSON array of 5 objects, no markdown:
[
  { "word": "ALGORITHM", "category": "${note.title.slice(0, 25)}", "hint": "A step-by-step mathematical recipe", "difficulty": "MEDIUM" }
]`;

            const aiResp = await this.openaiService.chatCompletion({
              userPrompt: aiPrompt,
              temperature: 0.7,
              maxTokens: 500,
            });

            const parsed = JSON.parse(
              aiResp.replace(/```json/g, '').replace(/```/g, '').trim(),
            );
            if (Array.isArray(parsed) && parsed.length >= 3) {
              scrambleBank = parsed.map((item, idx) => ({
                id: `ai-scramble-${idx + 1}`,
                word: String(item.word).toUpperCase().replace(/[^A-Z]/g, ''),
                category: String(item.category || note.title).slice(0, 30),
                hint: String(item.hint).slice(0, 110),
                difficulty: item.difficulty || 'MEDIUM',
                maxMistakes: 6,
              }));
            }
          } catch {
            // Procedural fallback
            if (Array.isArray(note.listsOfTopic)) {
              const extracted: ConceptScrambleRound[] = [];
              for (let i = 0; i < (note.listsOfTopic as any[]).length; i++) {
                const t = (note.listsOfTopic as any[])[i];
                const cleanWord = String(t?.topic || '')
                  .toUpperCase()
                  .replace(/[^A-Z]/g, '');
                if (cleanWord.length >= 4 && cleanWord.length <= 14) {
                  extracted.push({
                    id: `scramble-note-${i + 1}`,
                    word: cleanWord,
                    category: note.title,
                    hint: String(t?.explanation || 'Core note concept').slice(0, 110),
                    difficulty: cleanWord.length > 9 ? 'HARD' : 'MEDIUM',
                    maxMistakes: 6,
                  });
                }
              }
              if (extracted.length >= 3) {
                scrambleBank = extracted;
              }
            }
          }
        }
      }

      const selectedRounds = shuffleArray(scrambleBank).slice(0, 5);

      return {
        success: true,
        mode: 'CONCEPT_SCRAMBLE',
        noteTitle,
        totalRounds: selectedRounds.length,
        rounds: selectedRounds,
      };
    }

    if (dto.mode === 'SPEED_MATH') {
      const questions = generateDynamicMathQuestions().slice(0, 25);
      return {
        success: true,
        mode: 'SPEED_MATH',
        timeLimitSeconds: 60,
        totalQuestions: questions.length,
        questions,
      };
    }

    return {
      success: false,
      message: 'Unknown solo game mode requested',
    };
  }

  /**
   * Submits score for a completed solo brain game, awards XP & updates streak
   */
  async submitSoloScore(userId: string, dto: SubmitSoloScoreDto) {
    if (!userId) {
      throw new NotFoundException('User identifier is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Calculate XP based on mode, score, and accuracy
    let xpAwarded = 25; // Base XP
    const accuracy = Math.min(Math.max(dto.accuracy || 0, 0), 100);

    if (dto.mode === 'MEMORY_MATCH') {
      // Up to 50 XP (accuracy + speed bonus)
      const accuracyBonus = Math.round((accuracy / 100) * 15);
      const timeBonus = dto.timeSpentSeconds < 45 ? 10 : 5;
      xpAwarded = Math.min(25 + accuracyBonus + timeBonus, 50);
    } else if (dto.mode === 'CONCEPT_SCRAMBLE') {
      // Up to 75 XP (solved words bonus)
      const solvedCount = Math.min(dto.score || 0, 5);
      xpAwarded = Math.min(25 + solvedCount * 10, 75);
    } else if (dto.mode === 'SPEED_MATH') {
      // Up to 100 XP (correct answers count)
      const correctCount = Math.min(dto.score || 0, 25);
      xpAwarded = Math.min(25 + correctCount * 3, 100);
    }

    // Determine streak update
    const todayStr = new Date().toISOString().split('T')[0];
    let newStreak = user.streak;
    let newLongestStreak = user.longestStreak;

    if (user.lastCompletedDate !== todayStr) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (user.lastCompletedDate === yesterdayStr) {
        newStreak += 1;
      } else {
        newStreak = 1;
      }

      if (newStreak > newLongestStreak) {
        newLongestStreak = newStreak;
      }
    }

    // Transaction to update user stats & record GameMatch
    const [updatedUser, match] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          xpPoints: { increment: xpAwarded },
          streak: newStreak,
          longestStreak: newLongestStreak,
          lastCompletedDate: todayStr,
        },
      }),
      this.prisma.gameMatch.create({
        data: {
          mode: dto.mode as any,
          status: 'COMPLETED',
          hostUserId: userId,
          hostScore: Math.round(dto.score || 0),
          xpAwarded,
          noteId: dto.noteId,
          questionsJson: {
            accuracy,
            timeSpentSeconds: dto.timeSpentSeconds,
            details: dto.details || {},
          },
          completedAt: new Date(),
        },
      }),
    ]);

    const newRank = calculateRank(updatedUser.xpPoints);

    return {
      success: true,
      matchId: match.id,
      xpAwarded,
      totalXp: updatedUser.xpPoints,
      streak: updatedUser.streak,
      rank: newRank,
      summary: `Awesome work! You earned +${xpAwarded} Spark XP and advanced toward ${newRank.rankName}!`,
    };
  }

  /**
   * Retrieves player's personal arcade game history and performance stats
   */
  async getUserGameStats(userId: string) {
    if (!userId) {
      throw new NotFoundException('User identifier is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        username: true,
        xpPoints: true,
        streak: true,
        longestStreak: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const matches = await this.prisma.gameMatch.findMany({
      where: { hostUserId: userId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const modeCounts: Record<string, number> = {
      MEMORY_MATCH: 0,
      CONCEPT_SCRAMBLE: 0,
      SPEED_MATH: 0,
      QUIZ_BATTLE_1V1: 0,
      SCHOLAR_LADDER: 0,
    };

    let totalScore = 0;
    matches.forEach((m) => {
      if (modeCounts[m.mode] !== undefined) {
        modeCounts[m.mode]++;
      }
      totalScore += m.hostScore;
    });

    return {
      success: true,
      user: {
        ...user,
        rank: calculateRank(user.xpPoints),
      },
      stats: {
        totalGames: matches.length,
        averageScore:
          matches.length > 0 ? Math.round(totalScore / matches.length) : 0,
        modeCounts,
      },
      recentMatches: matches.map((m) => ({
        id: m.id,
        mode: m.mode,
        score: m.hostScore,
        xpAwarded: m.xpAwarded,
        playedAt: m.completedAt || m.createdAt,
      })),
    };
  }

  /**
   * Returns Arcade Leaderboard
   */
  async getArcadeLeaderboard(schoolId?: string) {
    // Only students compete on the leaderboard (no teachers, admins, finance or publisher accounts)
    const whereClause: any = { role: 'STUDENT' };
    if (schoolId) {
      whereClause.schoolId = schoolId;
    }

    const topUsers = await this.prisma.user.findMany({
      where: whereClause,
      select: {
        id: true,
        fullName: true,
        username: true,
        avatarUrl: true,
        xpPoints: true,
        streak: true,
        school: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { xpPoints: 'desc' },
      take: 25,
    });

    const leaderboard = topUsers.map((u, idx) => ({
      rank: idx + 1,
      userId: u.id,
      fullName: u.fullName || u.username || 'Anonymous Scholar',
      username: u.username || 'scholar',
      avatarUrl: u.avatarUrl,
      xpPoints: u.xpPoints,
      streak: u.streak,
      schoolName: u.school?.name || 'Independent Scholar',
      rankBadge: calculateRank(u.xpPoints).badge,
      rankTitle: calculateRank(u.xpPoints).rankName,
    }));

    return {
      success: true,
      schoolId,
      totalEntries: leaderboard.length,
      leaderboard,
    };
  }

  /**
   * Retrieves the 15-Level First-Class Scholar Ladder & player progression
   */
  async getScholarLadder(userId?: string) {
    let userXp = 0;
    let streak = 0;
    let longestStreak = 0;

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { xpPoints: true, streak: true, longestStreak: true },
      });
      if (user) {
        userXp = user.xpPoints || 0;
        streak = user.streak || 0;
        longestStreak = user.longestStreak || 0;
      }
    }

    const currentRank = calculateRank(userXp);

    const ladderTiers: ScholarLadderTier[] = SCHOLAR_LADDER_TIERS.map((tier) => ({
      level: tier.level,
      title: tier.title,
      minXp: tier.minXp,
      maxXp: tier.maxXp,
      badge: tier.badge,
      perk: tier.perk,
      isUnlocked: userXp >= tier.minXp,
      isCurrent: currentRank.rankLevel === tier.level,
    }));

    return {
      success: true,
      userXp,
      streak,
      longestStreak,
      currentRank,
      totalLevels: SCHOLAR_LADDER_TIERS.length,
      ladder: ladderTiers,
    };
  }

  /**
   * Generates or retrieves 5 balanced questions for a 1v1 Quiz Battle
   */
  async generateBattleQuestions(
    noteId?: string,
    category?: string,
  ): Promise<BattleQuestion[]> {
    if (noteId) {
      try {
        const note = await this.prisma.note.findUnique({
          where: { id: noteId },
          select: { title: true, summary: true },
        });

        if (note && note.summary) {
          const prompt = `Generate exactly 5 balanced multiple-choice questions for a 1v1 live academic battle based on this note:
Title: ${note.title}
Content: ${(note.summary || '').slice(0, 3000)}

Return ONLY valid JSON matching this structure:
[
  {
    "id": "q1",
    "question": "Clear, concise question?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Brief 1-sentence reason why this is correct",
    "category": "${category || note.title || 'Academic Concept'}"
  }
]`;

          const rawText = await this.openaiService.chatCompletion({
            systemPrompt:
              'You are an expert university professor creating competitive, fair, 4-choice academic quiz battle questions. Always return raw JSON only.',
            userPrompt: prompt,
            temperature: 0.6,
          });

          const cleanJson = (rawText || '[]').replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(cleanJson);

          if (Array.isArray(parsed) && parsed.length >= 3) {
            return parsed.slice(0, 5).map((q: any, idx: number) => ({
              id: q.id || `battle-ai-${idx + 1}`,
              question: String(q.question),
              options: Array.isArray(q.options)
                ? q.options.slice(0, 4).map(String)
                : ['A', 'B', 'C', 'D'],
              correctIndex: Number(q.correctIndex) || 0,
              explanation: String(q.explanation || ''),
              category: String(q.category || category || 'Academic Concept'),
            }));
          }
        }
      } catch (err) {
        console.warn('AI Battle question generation failed, using default pool:', err);
      }
    }

    // Default high-yield academic pool
    const shuffled = shuffleArray([...DEFAULT_BATTLE_QUESTIONS]);
    return shuffled.slice(0, 5);
  }

  /**
   * Creates a 1v1 Battle Match in the database
   */
  async createBattleMatch(hostUserId: string, dto: CreateBattleDto) {
    if (!hostUserId) {
      throw new NotFoundException('Host user ID is required');
    }

    const hostUser = await this.prisma.user.findUnique({
      where: { id: hostUserId },
      select: {
        id: true,
        fullName: true,
        username: true,
        avatarUrl: true,
        schoolId: true,
        xpPoints: true,
      },
    });

    if (!hostUser) {
      throw new NotFoundException('Host user not found');
    }

    // Generate unique 6-character room PIN (e.g. SPK-4921)
    let pin = 'SPK-' + Math.floor(1000 + Math.random() * 9000);
    let attempts = 0;
    while (attempts < 5) {
      const existing = await this.prisma.gameMatch.findUnique({
        where: { inviteCode: pin },
      });
      if (!existing) break;
      pin = 'SPK-' + Math.floor(1000 + Math.random() * 9000);
      attempts++;
    }

    const questions = await this.generateBattleQuestions(dto.noteId, dto.category);

    const match = await this.prisma.gameMatch.create({
      data: {
        mode: 'QUIZ_BATTLE_1V1',
        status: 'WAITING',
        hostUserId,
        schoolId: hostUser.schoolId,
        noteId: dto.noteId || null,
        inviteCode: pin,
        questionsJson: questions as any,
        hostScore: 0,
        opponentScore: 0,
        xpAwarded: 50,
      },
    });

    // Notify targeted friend if specified
    if (dto.targetOpponentUserId && this.notificationsService) {
      try {
        const hostDisplayName = hostUser.fullName || hostUser.username || 'A classmate';
        await this.notificationsService.dispatchNotification({
          userId: dto.targetOpponentUserId,
          title: '⚔️ 1v1 Battle Challenge!',
          body: `${hostDisplayName} challenged you to a Live Quiz Duel! Room PIN: ${pin}`,
          category: 'GAME_BATTLE',
          deepLink: `studentspark://games/battle?pin=${pin}`,
          dataJson: {
            matchId: match.id,
            inviteCode: pin,
            hostUserId,
          },
        });
      } catch (notifErr) {
        console.warn('Failed to send battle invite notification:', notifErr);
      }
    }

    return {
      success: true,
      matchId: match.id,
      inviteCode: pin,
      totalQuestions: questions.length,
      host: {
        id: hostUser.id,
        fullName: hostUser.fullName || hostUser.username || 'Host Scholar',
        username: hostUser.username,
        avatarUrl: hostUser.avatarUrl,
        rank: calculateRank(hostUser.xpPoints),
      },
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        category: q.category,
      })),
    };
  }

  /**
   * Joins an existing battle match by PIN
   */
  async joinBattleMatch(opponentUserId: string, inviteCode: string) {
    if (!inviteCode || !inviteCode.trim()) {
      throw new NotFoundException('Invite room PIN is required');
    }

    const normalizedCode = inviteCode.trim().toUpperCase();

    const match = await this.prisma.gameMatch.findFirst({
      where: {
        inviteCode: normalizedCode,
        status: { in: ['WAITING', 'IN_PROGRESS'] },
      },
      include: {
        hostUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatarUrl: true,
            xpPoints: true,
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException(`No active battle arena found with PIN ${normalizedCode}`);
    }

    let opponentUser: any = null;
    if (opponentUserId) {
      opponentUser = await this.prisma.user.findUnique({
        where: { id: opponentUserId },
        select: {
          id: true,
          fullName: true,
          username: true,
          avatarUrl: true,
          xpPoints: true,
        },
      });
    }

    // Attach opponent if waiting
    if (match.status === 'WAITING' && opponentUserId) {
      await this.prisma.gameMatch.update({
        where: { id: match.id },
        data: {
          opponentUserId,
          status: 'IN_PROGRESS',
        },
      });
    }

    const rawQuestions = (match.questionsJson as unknown as BattleQuestion[]) || [];

    return {
      success: true,
      matchId: match.id,
      inviteCode: match.inviteCode,
      status: 'IN_PROGRESS',
      host: {
        id: match.hostUser.id,
        fullName: match.hostUser.fullName || match.hostUser.username || 'Host Scholar',
        username: match.hostUser.username,
        avatarUrl: match.hostUser.avatarUrl,
        rank: calculateRank(match.hostUser.xpPoints),
      },
      opponent: opponentUser
        ? {
            id: opponentUser.id,
            fullName: opponentUser.fullName || opponentUser.username || 'Challenger',
            username: opponentUser.username,
            avatarUrl: opponentUser.avatarUrl,
            rank: calculateRank(opponentUser.xpPoints),
          }
        : null,
      totalQuestions: rawQuestions.length,
      questions: rawQuestions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        category: q.category,
      })),
    };
  }

  /**
   * Retrieves match details by PIN or ID
   */
  async getBattleMatchByPin(codeOrId: string) {
    const normalized = (codeOrId || '').trim().toUpperCase();

    const match = await this.prisma.gameMatch.findFirst({
      where: {
        OR: [{ inviteCode: normalized }, { id: codeOrId }],
      },
      include: {
        hostUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatarUrl: true,
            xpPoints: true,
          },
        },
        opponentUser: {
          select: {
            id: true,
            fullName: true,
            username: true,
            avatarUrl: true,
            xpPoints: true,
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException('Battle match not found');
    }

    const rawQuestions = (match.questionsJson as unknown as BattleQuestion[]) || [];

    return {
      success: true,
      match: {
        id: match.id,
        inviteCode: match.inviteCode,
        status: match.status,
        hostScore: match.hostScore,
        opponentScore: match.opponentScore,
        winnerId: match.winnerId,
        createdAt: match.createdAt,
        host: match.hostUser,
        opponent: match.opponentUser,
        totalQuestions: rawQuestions.length,
      },
    };
  }

  /**
   * Completes a battle match and awards XP & streak updates
   */
  async completeBattleMatch(
    matchId: string,
    hostScore: number,
    opponentScore: number,
    winnerId?: string,
  ) {
    const match = await this.prisma.gameMatch.findUnique({
      where: { id: matchId },
      include: { hostUser: true, opponentUser: true },
    });

    if (!match) {
      throw new NotFoundException('Battle match not found');
    }

    let resolvedWinnerId = winnerId;
    if (!resolvedWinnerId) {
      if (hostScore > opponentScore) {
        resolvedWinnerId = match.hostUserId;
      } else if (opponentScore > hostScore && match.opponentUserId) {
        resolvedWinnerId = match.opponentUserId;
      }
    }

    const isTie = hostScore === opponentScore;

    // XP calculation: Winner = +60 XP, Loser = +25 XP, Tie = +40 XP
    const hostXpAward = isTie ? 40 : resolvedWinnerId === match.hostUserId ? 60 : 25;
    const opponentXpAward = isTie
      ? 40
      : match.opponentUserId && resolvedWinnerId === match.opponentUserId
      ? 60
      : 25;

    // Update match record
    const updatedMatch = await this.prisma.gameMatch.update({
      where: { id: matchId },
      data: {
        hostScore,
        opponentScore,
        winnerId: resolvedWinnerId || null,
        status: 'COMPLETED',
        completedAt: new Date(),
        xpAwarded: Math.max(hostXpAward, opponentXpAward),
      },
    });

    // Update host XP & streak
    const [updatedHost] = await Promise.all([
      this.prisma.user.update({
        where: { id: match.hostUserId },
        data: {
          xpPoints: { increment: hostXpAward },
          streak: { increment: 1 },
          lastCompletedDate: new Date().toISOString(),
        },
        select: { id: true, xpPoints: true, streak: true },
      }),
      match.opponentUserId
        ? this.prisma.user.update({
            where: { id: match.opponentUserId },
            data: {
              xpPoints: { increment: opponentXpAward },
              streak: { increment: 1 },
              lastCompletedDate: new Date().toISOString(),
            },
            select: { id: true, xpPoints: true, streak: true },
          })
        : Promise.resolve(null),
    ]);

    return {
      success: true,
      matchId: updatedMatch.id,
      hostScore,
      opponentScore,
      winnerId: resolvedWinnerId,
      isTie,
      hostXpAwarded: hostXpAward,
      opponentXpAwarded: opponentXpAward,
      hostRank: calculateRank(updatedHost.xpPoints),
    };
  }

  /**
   * Dispatches challenge invite notification to a classmate
   */
  async inviteBattleFriend(senderUserId: string, dto: InviteBattleFriendDto) {
    if (!this.notificationsService) {
      return { success: false, message: 'Notifications service unavailable' };
    }

    const sender = await this.prisma.user.findUnique({
      where: { id: senderUserId },
      select: { fullName: true, username: true },
    });

    const senderName = sender?.fullName || sender?.username || 'A classmate';

    await this.notificationsService.dispatchNotification({
      userId: dto.friendUserId,
      title: '⚔️ 1v1 Battle Challenge!',
      body: `${senderName} challenged you to a Live Quiz Duel! Room PIN: ${dto.inviteCode}`,
      category: 'GAME_BATTLE',
      deepLink: `studentspark://games/battle?pin=${dto.inviteCode}`,
      dataJson: {
        inviteCode: dto.inviteCode,
        senderUserId,
        noteTitle: dto.noteTitle,
      },
    });

    return {
      success: true,
      message: `Challenge sent to classmate! PIN: ${dto.inviteCode}`,
    };
  }
}
