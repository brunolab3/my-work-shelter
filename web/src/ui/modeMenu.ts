// The permission mode picker of a conversation's status line (ModePicker in Dialog.tsx): its rows, which choice asks
// first and whether the conversation can still change it. The server applies it with `permissionMode`
// (sessions.mode in server/sessions.ts)
import { PERMISSION_MODES, type SessionSummary } from '@shared/protocol';

export interface ModeRow { value: string; text: string; hint: string; current: boolean }

// every mode, the current one marked; plan's hint says what switching mid-conversation does
export const modeRows = (current?: string): ModeRow[] =>
  PERMISSION_MODES.map(m => ({ value: m.value, text: m.text, hint: m.value === 'plan' && current !== 'plan' ? 'windows.mode.planNow' : m.hint, current: m.value === current }));

// skipping every permission asks the Overseer first
export const confirmsFirst = (mode: string, current?: string) => mode === 'bypassPermissions' && current !== mode;

// a closed conversation has no Claude Code process to tell: its mode is only shown
export const modeChangeable = (s: Pick<SessionSummary, 'state'>) => s.state !== 'closed';
