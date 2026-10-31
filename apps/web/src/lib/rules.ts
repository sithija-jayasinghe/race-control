import {
  rulePreviewSchema,
  ruleSchema,
  ruleTestResultSchema,
  ruleWithStatsSchema,
  type RuleInput,
  type RuleUpdate,
} from '@race-control/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { api } from '@/lib/api';

export const rulesKey = (teamId: string) => ['teams', teamId, 'rules'] as const;

/** The team's rules, with how often each matched in the last 7 days. */
export function useRules(teamId: string) {
  return useQuery({
    queryKey: rulesKey(teamId),
    queryFn: () => api(`/teams/${teamId}/rules`, { schema: z.array(ruleWithStatsSchema) }),
  });
}

/** Leads only. New rules start in shadow mode. */
export function useCreateRule(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rule: RuleInput) => api(`/teams/${teamId}/rules`, { method: 'POST', body: rule, schema: ruleSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rulesKey(teamId) }),
  });
}

export function useUpdateRule(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, ...update }: RuleUpdate & { ruleId: string }) =>
      api(`/teams/${teamId}/rules/${ruleId}`, { method: 'PATCH', body: update, schema: ruleSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rulesKey(teamId) }),
  });
}

export function useAddStarterRules(teamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/teams/${teamId}/rules/starter`, { method: 'POST' }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: rulesKey(teamId) }),
  });
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** The test lane: what the team's rules would do with a file edit or a command. */
export function useRuleTest(teamId: string, input: string, rulesVersion: number) {
  const settled = useDebounced(input.trim());
  return useQuery({
    queryKey: [...rulesKey(teamId), 'test', settled, rulesVersion],
    queryFn: () => api(`/teams/${teamId}/rules/test`, { method: 'POST', body: { input: settled }, schema: ruleTestResultSchema }),
    enabled: settled.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** How often a draft rule would have matched the team's recent tool calls. Leads only. */
export function useRulePreview(teamId: string, tool: string, pattern: string) {
  // Strings, not an object: a new object each render would never settle.
  const settled = { tool: useDebounced(tool), pattern: useDebounced(pattern.trim()) };
  return useQuery({
    queryKey: [...rulesKey(teamId), 'preview', settled.tool, settled.pattern],
    queryFn: () => api(`/teams/${teamId}/rules/preview`, { method: 'POST', body: settled, schema: rulePreviewSchema }),
    enabled: settled.tool.length > 0 && settled.pattern.length > 0,
    placeholderData: keepPreviousData,
  });
}
