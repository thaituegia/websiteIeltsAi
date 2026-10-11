/** Independently authored interview material. Models stay in stored answer material. */
export interface SpeakingQuestionResponse { prompt: string; answer: string }
export interface SpeakingInterviewPack { topic: string; band: number; questions: SpeakingQuestionResponse[] }
export interface SpeakingLongTurnPack {
  topic: string; band: number; cue: string;
  points: [string, string, string, string]; answer: string;
}
export interface SpeakingMockPack {
  topic: string; band: number; part1: SpeakingQuestionResponse[];
  cue: string; points: [string, string, string, string]; answer: string;
  part3: SpeakingQuestionResponse[];
}
