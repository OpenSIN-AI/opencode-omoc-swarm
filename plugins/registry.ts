/**
 * Registry-driven subagent resolution for OMOC Swarm
 * 
 * This module provides durable member identity tracking that survives
 * session restarts and avoids brittle title-based inference.
 */

export interface SwarmMemberRegistryEntry {
  schemaVersion: number;
  memberName: string;
  agentId: string;
  capabilities?: string[];
  createdAt: number;
  lastSeenAt?: number;
}

export interface SwarmRegistry {
  version: number;
  swarmId: string;
  createdAt: number;
  members: Record<string, SwarmMemberRegistryEntry>;
}

/**
 * Known agent aliases - maps legacy role names to canonical agent IDs
 */
export const AGENT_ALIASES: Record<string, string> = {
  // Legacy role names
  planner: 'plan',
  researcher: 'explore',
  coder: 'build',
  reviewer: 'general',
  
  // Canonical names (identity mapping)
  plan: 'plan',
  explore: 'explore',
  build: 'build',
  general: 'general',
  
  // Additional known agents
  oracle: 'oracle',
  metis: 'metis',
  momus: 'momus',
  librarian: 'librarian',
};

/**
 * List of all valid agent IDs
 */
export const VALID_AGENT_IDS = [
  'plan',
  'build',
  'explore',
  'general',
  'oracle',
  'metis',
  'momus',
  'librarian',
] as const;

export type ValidAgentId = typeof VALID_AGENT_IDS[number];

/**
 * Validates if an agent ID is known/valid
 */
export function isValidAgentId(agentId: string): agentId is ValidAgentId {
  return VALID_AGENT_IDS.includes(agentId as ValidAgentId);
}

/**
 * Resolves an agent ID from an alias or canonical name.
 * Returns null if the agent ID is unknown (not in the known set).
 * 
 * @param agentId - The agent ID or alias to resolve
 * @returns The canonical agent ID, or null if unknown
 */
export function resolveAgentId(agentId: string): string | null {
  const normalized = agentId.toLowerCase().trim();
  
  // Check if it's a known alias
  if (AGENT_ALIASES[normalized]) {
    return AGENT_ALIASES[normalized];
  }
  
  // Check if it's a valid agent ID directly
  if (isValidAgentId(normalized)) {
    return normalized;
  }
  
  // Unknown agent
  return null;
}

/**
 * Creates a new registry entry for a swarm member
 */
export function createRegistryEntry(
  memberName: string,
  agentId: string
): SwarmMemberRegistryEntry | null {
  const resolvedAgentId = resolveAgentId(agentId);
  
  if (!resolvedAgentId) {
    return null;
  }
  
  return {
    schemaVersion: 1,
    memberName: memberName.toLowerCase().trim(),
    agentId: resolvedAgentId,
    capabilities: [],
    createdAt: Date.now(),
  };
}

/**
 * Validates a complete registry structure
 */
export function validateRegistry(registry: unknown): registry is SwarmRegistry {
  if (!registry || typeof registry !== 'object') return false;
  
  const reg = registry as Partial<SwarmRegistry>;
  
  if (reg.version !== 1) return false;
  if (!reg.swarmId || typeof reg.swarmId !== 'string') return false;
  if (!reg.members || typeof reg.members !== 'object') return false;
  
  // Validate each member entry
  for (const [key, entry] of Object.entries(reg.members)) {
    if (!validateRegistryEntry(entry)) return false;
    if (entry.memberName !== key) return false; // Key must match memberName
  }
  
  return true;
}

/**
 * Validates a single registry entry
 */
export function validateRegistryEntry(entry: unknown): entry is SwarmMemberRegistryEntry {
  if (!entry || typeof entry !== 'object') return false;
  
  const e = entry as Partial<SwarmMemberRegistryEntry>;
  
  if (e.schemaVersion !== 1) return false;
  if (!e.memberName || typeof e.memberName !== 'string') return false;
  if (!e.agentId || typeof e.agentId !== 'string') return false;
  if (!resolveAgentId(e.agentId)) return false;
  if (e.createdAt && typeof e.createdAt !== 'number') return false;
  if (e.lastSeenAt && typeof e.lastSeenAt !== 'number') return false;
  
  return true;
}

/**
 * Generates a diagnostic message for unknown agent IDs
 */
export function getUnknownAgentDiagnostic(
  unknownAgentId: string,
  validAgents: string[]
): string {
  const validList = validAgents.join(', ');
  const suggestions = getAgentSuggestions(unknownAgentId);
  
  let msg = `Unknown agent ID: "${unknownAgentId}"\n`;
  msg += `Valid agent IDs: ${validList}\n`;
  
  if (suggestions.length > 0) {
    msg += `\nDid you mean: ${suggestions.join(', ')}?`;
  }
  
  return msg;
}

/**
 * Suggests similar agent IDs for a given input
 */
export function getAgentSuggestions(input: string): string[] {
  const normalized = input.toLowerCase().trim();
  const suggestions: string[] = [];
  
  // Check for partial matches
  for (const agentId of VALID_AGENT_IDS) {
    if (agentId.includes(normalized) || normalized.includes(agentId)) {
      suggestions.push(agentId);
    }
  }
  
  return suggestions.slice(0, 3);
}
