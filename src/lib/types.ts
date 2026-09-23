export interface SchemaField {
  key: string;
  label: string;
  type: 'number' | 'text';
  group: string;
  counter?: boolean;
  unit?: string;
}
export interface SchemaCheckbox {
  label: string;
  habitKey: string;
}
export interface Schema {
  vaultMarker: string;
  dailyNote: {
    path: string;
    templatePath: string;
    dateFormat: string;
    frontmatter: SchemaField[];
    checkboxes: SchemaCheckbox[];
    habitsSection: string;
    logSection: string;
  };
  finance: {
    raw: string;
    files: Record<string, string>;
    londonFund: string;
    account: string;
    categories: { spend: string[]; tracked: string[]; income: string[] };
  };
  habits: { csv: string; columns: string[] };
  calendar: { csv: string; columns: string[]; categories: string[] };
  inbox: { path: string; note?: string };
}

export interface LogEntry {
  time: string;
  text: string;
}
export interface Daily {
  date: string;
  exists: boolean;
  frontmatter: Record<string, unknown>;
  habits: Record<string, boolean>;
  log: LogEntry[];
}

export interface DebtView {
  creditor: string;
  principal: number;
  target: number;
  note: string;
  paid: number;
  remaining: number;
  monthPaid: number;
}
export interface LondonView {
  banked: number;
  floor: number | null;
  full: number | null;
  gapFloor: number | null;
}
export interface FinanceSummary {
  banked: number;
  monthKey: string;
  monthIn: number;
  monthOut: number;
  net: number;
  byCategory: Record<string, number>;
  budgets: Record<string, number>;
  debts: DebtView[];
  london: LondonView | null;
  recent: { date: string; amount: number; category: string; note: string }[];
}

export interface Streaks {
  streaks: Record<string, number>;
  last7: Record<string, boolean[]>;
  smokedRecent: { date: string; smoked: number }[];
  days: string[];
}

export interface CalEvent {
  id: string;
  start: string;
  end: string;
  title: string;
  category: string;
  location: string;
  notes: string;
  allday: boolean;
}

// ---- gamification (Status window) ----------------------------------------
export interface StatBlock {
  points: number;
  level: number;
  into: number; // points earned into the current level
  need: number; // points needed to clear the current level
}
export interface CharLevel {
  level: number;
  into: number;
  need: number;
  total: number; // lifetime EXP
}
export interface Quest {
  date: string;
  pushups: number;
  situps: number;
  running: number;
  submitted: number;
}
export interface GameState {
  generatedAt: string;
  timezone: string;
  today: string;
  character: CharLevel;
  stats: Record<string, StatBlock>;
  breakdown: Record<string, Record<string, number>>;
  quest: Quest;
}
export interface AppSettings {
  timezone: string;
}
