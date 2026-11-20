export interface OlympiadBankQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  points: number;
  timeLimitSeconds: number;
}

export type OlympiadBankKey =
  | 'ENGINEERING_CS'
  | 'SECONDARY_STEM'
  | 'NATIONAL_SCHOLARS';

export const OLYMPIAD_QUESTION_BANKS: Record<
  OlympiadBankKey,
  OlympiadBankQuestion[]
> = {
  ENGINEERING_CS: [
    {
      prompt:
        'What is the worst-case time complexity of searching for a target key in a balanced Binary Search Tree (AVL Tree) with n nodes?',
      options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
      correctIndex: 1,
      explanation:
        'Because an AVL tree keeps height strictly O(log n), search comparisons scale logarithmically.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'According to Kirchhoff’s Current Law (KCL), what must equal zero at any closed electrical node?',
      options: [
        'Sum of node voltages',
        'Algebraic sum of currents entering and leaving',
        'Total dissipated power',
        'Product of resistance and capacitance',
      ],
      correctIndex: 1,
      explanation:
        'Conservation of electric charge dictates that net current entering a node equals net current leaving it.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Which data structure operates strictly on the Last-In, First-Out (LIFO) principle for function call frames?',
      options: ['Priority Queue', 'Circular Buffer', 'Stack', 'Hash Map'],
      correctIndex: 2,
      explanation:
        'A Call Stack pushes active stack frames and pops the most recent frame upon function return.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Two resistors of 6 Ω and 3 Ω are connected in parallel across a 12 V DC source. What total current is drawn?',
      options: ['2 A', '4 A', '6 A', '9 A'],
      correctIndex: 2,
      explanation:
        'R_eq = (6×3)/(6+3) = 2 Ω, so total current I = 12 V / 2 Ω = 6 A.',
      points: 100,
      timeLimitSeconds: 25,
    },
    {
      prompt:
        'In thermodynamics, the efficiency of an ideal Carnot heat engine operating between reservoirs T_hot and T_cold (in Kelvin) depends ONLY on:',
      options: [
        'Mass of working fluid',
        'Temperatures of the hot and cold reservoirs',
        'Cylinder volume ratio alone',
        'Thermal conductivity of piston walls',
      ],
      correctIndex: 1,
      explanation:
        'Carnot efficiency η = 1 - (T_cold / T_hot) depends solely on absolute reservoir temperatures.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'What is the binary representation of the hexadecimal value 0x2F?',
      options: ['0010 1111', '0011 1110', '0100 1111', '0010 1101'],
      correctIndex: 0,
      explanation: '2 in hex = 0010 and F (15) in hex = 1111, giving 0010 1111.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Evaluate the definite integral ∫₀² (3x² + 2x) dx:',
      options: ['8', '10', '12', '16'],
      correctIndex: 2,
      explanation:
        'Antiderivative is x³ + x². Evaluated from 0 to 2 gives (8 + 4) - 0 = 12.',
      points: 100,
      timeLimitSeconds: 25,
    },
    {
      prompt:
        'Which HTTP status code indicates that an authenticated user lacks permission to access a protected resource?',
      options: ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '409 Conflict'],
      correctIndex: 2,
      explanation:
        '403 Forbidden signifies authenticated identity exists, but authorization/role privileges are denied.',
      points: 100,
      timeLimitSeconds: 20,
    },
  ],
  SECONDARY_STEM: [
    {
      prompt: 'Solve for x if 3(2x - 4) = 18:',
      options: ['x = 3', 'x = 4', 'x = 5', 'x = 6'],
      correctIndex: 2,
      explanation: 'Dividing both sides by 3 gives 2x - 4 = 6 → 2x = 10 → x = 5.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Which organelle in green plant cells traps sunlight energy during photosynthesis?',
      options: ['Mitochondrion', 'Chloroplast', 'Ribosome', 'Golgi body'],
      correctIndex: 1,
      explanation:
        'Chloroplasts contain chlorophyll, which absorbs light energy to convert CO₂ and water into glucose.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'A car travels 150 km at an average speed of 50 km/h. How long does the journey take?',
      options: ['2 hours', '2.5 hours', '3 hours', '3.5 hours'],
      correctIndex: 2,
      explanation: 'Time = Distance / Speed = 150 km / 50 km/h = 3 hours.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'What gas turns limewater (calcium hydroxide solution) milky when bubbled through it?',
      options: ['Oxygen', 'Nitrogen', 'Carbon(IV) oxide (CO₂)', 'Hydrogen'],
      correctIndex: 2,
      explanation:
        'CO₂ reacts with Ca(OH)₂ to form an insoluble white precipitate of CaCO₃.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'The interior angles of a triangle are in the ratio 2 : 3 : 4. What is the largest angle?',
      options: ['60°', '80°', '90°', '100°'],
      correctIndex: 1,
      explanation: '2k + 3k + 4k = 180° → 9k = 180° → k = 20°. Largest = 4×20° = 80°.',
      points: 100,
      timeLimitSeconds: 25,
    },
    {
      prompt: 'Which SI unit is used to measure electrical resistance?',
      options: ['Watt (W)', 'Volt (V)', 'Ampere (A)', 'Ohm (Ω)'],
      correctIndex: 3,
      explanation: 'Electrical resistance is measured in Ohms (Ω).',
      points: 100,
      timeLimitSeconds: 18,
    },
    {
      prompt:
        'When a solid changes directly into a gas without becoming a liquid first, the process is called:',
      options: ['Evaporation', 'Condensation', 'Sublimation', 'Distillation'],
      correctIndex: 2,
      explanation:
        'Sublimation is the direct phase transition from solid to gas (e.g., iodine crystals or dry ice).',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Find the perimeter of a rectangle with length 14 cm and width 9 cm:',
      options: ['23 cm', '46 cm', '63 cm', '126 cm'],
      correctIndex: 1,
      explanation: 'Perimeter = 2(l + w) = 2(14 + 9) = 46 cm.',
      points: 100,
      timeLimitSeconds: 20,
    },
  ],
  NATIONAL_SCHOLARS: [
    {
      prompt:
        'Which river is the longest in Nigeria and merges with the Benue River at Lokoja?',
      options: ['River Ogun', 'River Niger', 'Cross River', 'River Sokoto'],
      correctIndex: 1,
      explanation: 'The Niger and Benue rivers meet at the confluence city of Lokoja.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'If 5 machines take 5 minutes to assemble 5 devices, how long would 100 machines take to assemble 100 devices?',
      options: ['1 minute', '5 minutes', '20 minutes', '100 minutes'],
      correctIndex: 1,
      explanation:
        'Each machine produces 1 device in 5 minutes independently, so 100 machines make 100 devices in 5 minutes.',
      points: 100,
      timeLimitSeconds: 25,
    },
    {
      prompt:
        'In macroeconomics, what happens when persistent excess money chases too few goods across an economy?',
      options: ['Deflation', 'Inflation', 'Appreciation', 'Surplus balance'],
      correctIndex: 1,
      explanation: 'Demand-pull inflation raises the general price level as purchasing power outpaces supply.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Which planet in our solar system has the highest average surface temperature due to its runaway greenhouse atmosphere?',
      options: ['Mercury', 'Venus', 'Mars', 'Jupiter'],
      correctIndex: 1,
      explanation:
        'Although Mercury is closer to the Sun, Venus’s dense CO₂ atmosphere traps heat to exceed 460 °C.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'Identify the next number in the sequence: 3, 6, 11, 18, 27, ...',
      options: ['36', '38', '40', '42'],
      correctIndex: 1,
      explanation: 'Differences grow by +2 each step (+3, +5, +7, +9, +11): 27 + 11 = 38.',
      points: 100,
      timeLimitSeconds: 25,
    },
    {
      prompt:
        'Who wrote the classic Nigerian literary novel "Things Fall Apart"?',
      options: ['Wole Soyinka', 'Chinua Achebe', 'Chimamanda Adichie', 'Ben Okri'],
      correctIndex: 1,
      explanation: 'Chinua Achebe published Things Fall Apart in 1958.',
      points: 100,
      timeLimitSeconds: 18,
    },
    {
      prompt:
        'What does HTTPS primarily guarantee beyond standard HTTP during client-server communication?',
      options: [
        'Faster CPU processing',
        'Unlimited storage quota',
        'TLS encryption & server identity authentication',
        'Automatic offline database sync',
      ],
      correctIndex: 2,
      explanation:
        'HTTPS wraps HTTP inside TLS to protect confidentiality, integrity, and server authenticity.',
      points: 100,
      timeLimitSeconds: 20,
    },
    {
      prompt:
        'A student scored 72, 84, 90, and 74 across four tests. What is the arithmetic mean score?',
      options: ['78', '80', '82', '84'],
      correctIndex: 1,
      explanation: 'Sum = 72 + 84 + 90 + 74 = 320; mean = 320 / 4 = 80.',
      points: 100,
      timeLimitSeconds: 25,
    },
  ],
};

export function resolveQuestionBank(
  key?: 'ENGINEERING_CS' | 'SECONDARY_STEM' | 'NATIONAL_SCHOLARS' | 'CUSTOM',
  subjectArea?: string,
): OlympiadBankQuestion[] {
  if (key && key !== 'CUSTOM' && OLYMPIAD_QUESTION_BANKS[key]) {
    return OLYMPIAD_QUESTION_BANKS[key];
  }
  const lower = (subjectArea || '').toLowerCase();
  if (
    lower.includes('eng') ||
    lower.includes('csc') ||
    lower.includes('comp') ||
    lower.includes('tech') ||
    lower.includes('eee')
  ) {
    return OLYMPIAD_QUESTION_BANKS.ENGINEERING_CS;
  }
  if (
    lower.includes('jss') ||
    lower.includes('sss') ||
    lower.includes('secondary') ||
    lower.includes('basic') ||
    lower.includes('math') ||
    lower.includes('stem')
  ) {
    return OLYMPIAD_QUESTION_BANKS.SECONDARY_STEM;
  }
  return OLYMPIAD_QUESTION_BANKS.NATIONAL_SCHOLARS;
}
