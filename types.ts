
export interface FormData {
  fullName: string;
  dob: string;
  city: string;
}

export enum SessionState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  THINKING = 'THINKING',
  SPEAKING = 'SPEAKING',
  DONE = 'DONE',
  ERROR = 'ERROR',
  EXTRACTING = 'EXTRACTING'
}

export interface TranscriptionRecord {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}
