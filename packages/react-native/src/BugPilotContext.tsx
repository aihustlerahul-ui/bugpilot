import { createContext, useContext } from 'react';
import type { BugPilotContextValue } from './types';

export const BugPilotContext = createContext<BugPilotContextValue | null>(null);

export function useBugPilot(): BugPilotContextValue {
  const ctx = useContext(BugPilotContext);
  if (!ctx) {
    throw new Error('useBugPilot must be used within BugPilotProvider');
  }
  return ctx;
}
