export type GameModeType =
  | 'MEMORY_MATCH'
  | 'CONCEPT_SCRAMBLE'
  | 'SPEED_MATH'
  | 'QUIZ_BATTLE_1V1'
  | 'SCHOLAR_LADDER';

export class GenerateSoloGameDto {
  mode: 'MEMORY_MATCH' | 'CONCEPT_SCRAMBLE' | 'SPEED_MATH';
  noteId?: string;
  courseCode?: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'HARD';
}

export class SubmitSoloScoreDto {
  mode: 'MEMORY_MATCH' | 'CONCEPT_SCRAMBLE' | 'SPEED_MATH';
  score: number;
  accuracy: number;
  timeSpentSeconds: number;
  noteId?: string;
  details?: Record<string, any>;
}

export interface MemoryMatchCard {
  id: string;
  pairId: string;
  type: 'TERM' | 'DEFINITION';
  content: string;
}

export interface ConceptScrambleRound {
  id: string;
  word: string;
  category: string;
  hint: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  maxMistakes: number;
}

export interface SpeedMathQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  category: string;
}

export interface BattleQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  category?: string;
}

export class CreateBattleDto {
  noteId?: string;
  category?: string;
  targetOpponentUserId?: string;
}

export class JoinBattleDto {
  inviteCode: string;
}

export class InviteBattleFriendDto {
  friendUserId: string;
  inviteCode: string;
  noteTitle?: string;
}

export interface ScholarLadderTier {
  level: number;
  title: string;
  minXp: number;
  maxXp: number;
  badge: string;
  perk: string;
  isUnlocked: boolean;
  isCurrent: boolean;
}
