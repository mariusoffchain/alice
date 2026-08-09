import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_KEY = 'alice_diagnostic_logs';
const MAX_LOGS = 100;

export type DiagnosticLog = {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
  createdAt: number;
};

function sanitize(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\b(?:[a-z]+\s+){11,23}[a-z]+\b/gi, '[sensitive value hidden]')
    .slice(0, 500);
}

export async function getDiagnosticLogs(): Promise<DiagnosticLog[]> {
  const raw = await AsyncStorage.getItem(LOG_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DiagnosticLog[];
  } catch {
    return [];
  }
}

export async function addDiagnosticLog(level: DiagnosticLog['level'], message: string, detail?: string): Promise<void> {
  const logs = await getDiagnosticLogs();
  logs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    message: sanitize(message) ?? 'Diagnostic event',
    detail: sanitize(detail),
    createdAt: Date.now(),
  });
  await AsyncStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
}

export async function clearDiagnosticLogs(): Promise<void> {
  await AsyncStorage.removeItem(LOG_KEY);
}
