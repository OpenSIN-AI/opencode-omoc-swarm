import type { Config } from "@opencode-ai/sdk";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

type SwarmMemberConfig = {
  name: string;
  agent: string;
};

type SwarmMember = SwarmMemberConfig & {
  sessionID: string;
};

type SwarmState = {
  id: string;
  directory: string;
  worktree: string;
  createdAt: number;
  createdBySessionID: string;
  members: Record<string, SwarmMember>;
};

const swarms = new Map<string, SwarmState>();
const swarmBySessionID = new Map<string, string>();
let latestConfig: Config | undefined;

function createSwarmId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `swarm_${time}_${rand}`;
}

function normalizeMemberName(name: string): string {
  return name.trim().toLowerCase();
}

function defaultAgentForMemberName(memberName: string): string {
  const key = normalizeMemberName(memberName);
  if (key === "planner") return "plan";
  if (key === "researcher") return "explore";
  if (key === "coder") return "build";
  if (key === "reviewer") return "general";
  return "general";
}

function formatSwarm(swarm: SwarmState): string {
  const members = Object.values(swarm.members)
    .map((m) => `- ${m.name}: agent=${m.agent} session=${m.sessionID}`)
    .join("\n");
  return [
    `swarm: ${swarm.id}`,
    `dir: ${swarm.directory}`,
    `worktree: ${swarm.worktree}`,
    `members:`,
    members || "- (none)",
  ].join("\n");
}

function extractText(parts: Array<any>): string {
  const textChunks = parts
    .filter((p) => p && (p.type === "text" || p.type === "reasoning") && typeof p.text === "string")
    .map((p) => p.text.trim())
    .filter(Boolean);
  return textChunks.join("\n\n").trim();
}

function getAgentModelKey(agentId: string): string {
  const explicit = latestConfig?.agent?.[agentId]?.model;
  const fallback = latestConfig?.model;
  return explicit || fallback || `agent:${agentId}`;
}

function groupMembersByModel(members: SwarmMember[]): Map<string, SwarmMember[]> {
  const groups = new Map<string, SwarmMember[]>();
  for (const member of members) {
    const key = getAgentModelKey(member.agent);
    const list = groups.get(key);
    if (list) list.push(member);
    else groups.set(key, [member]);
  }
  return groups;
}

async function must<T>(label: string, promise: Promise<any>): Promise<T> {
  const result = await promise;
  if (!result) throw new Error(`${label}: no response`);
  if (result.error) {
    const errorMessage =
      typeof result.error === "string"
        ? result.error
        : result.error?.data?.message ||
          result.error?.message ||
          result.error?.name ||
          JSON.stringify(result.error);
    throw new Error(`${label}: ${errorMessage}`);
  }
  return result.data as T;
}

function parseSwarmTitle(title: string): { swarmId?: string; memberName?: string } {
  const raw = title.trim();
  const colonIndex = raw.indexOf(":");
  if (colonIndex === -1) return {};
  const swarmId = raw.slice(0, colonIndex).trim();
  const memberName = raw.slice(colonIndex + 1).trim();
  if (!swarmId || !memberName) return {};
  return { swarmId, memberName };
}

async function discoverSwarmForSession(
  client: any,
  sessionID: string,
  directory: string,
  worktree: string,
): Promise<SwarmState | undefined> {
  try {
    const current = await must<any>(
      `get session ${sessionID}`,
      client.session.get({ query: { directory }, path: { id: sessionID } }),
    );

    const rootID = current.parentID || current.id;
    const root = rootID === current.id
      ? current
      : await must<any>(`get root session ${rootID}`, client.session.get({ query: { directory }, path: { id: rootID } }));

    const children = await must<any[]>(
      `list children for ${rootID}`,
      client.session.children({ query: { directory }, path: { id: rootID } }),
    );

    const prefixCounts = new Map<string, number>();
    for (const child of children) {
      const parsed = parseSwarmTitle(child.title || "");
      if (!parsed.swarmId || !parsed.memberName) continue;
      prefixCounts.set(parsed.swarmId, (prefixCounts.get(parsed.swarmId) || 0) + 1);
    }

    const bestPrefix = Array.from(prefixCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const fallbackPrefix = parseSwarmTitle(root.title || "").swarmId;
    const swarmId = bestPrefix || fallbackPrefix || `auto_${rootID}`;

    const members: Record<string, SwarmMember> = {};
    for (const child of children) {
      const parsed = parseSwarmTitle(child.title || "");
      if (!parsed.memberName) continue;
      if (parsed.swarmId && parsed.swarmId !== swarmId) continue;
      const normalized = normalizeMemberName(parsed.memberName);
      if (!normalized) continue;
      members[normalized] = {
        name: normalized,
        agent: defaultAgentForMemberName(normalized),
        sessionID: child.id,
      };
    }

    const swarm: SwarmState = {
      id: swarmId,
      directory,
      worktree,
      createdAt: root?.time?.created ?? Date.now(),
      createdBySessionID: rootID,
      members,
    };

    swarms.set(swarmId, swarm);
    swarmBySessionID.set(rootID, swarmId);
    swarmBySessionID.set(sessionID, swarmId);
    for (const member of Object.values(members)) swarmBySessionID.set(member.sessionID, swarmId);

    return swarm;
  } catch {
    return undefined;
  }
}

async function resolveSwarm(
  client: any,
  argsSwarmId: string | undefined,
  sessionID: string,
  directory: string,
  worktree: string,
): Promise<{ swarmId: string; swarm: SwarmState } | { error: string }> {
  const directId = argsSwarmId || swarmBySessionID.get(sessionID);
  if (directId) {
    const existing = swarms.get(directId);
    if (existing) return { swarmId: directId, swarm: existing };
  }

  const discovered = await discoverSwarmForSession(client, sessionID, directory, worktree);
  if (discovered) return { swarmId: discovered.id, swarm: discovered };

  return { error: "Error: no swarm bound to this session (run swarm.create, swarm.discover, or pass id)" };
}

function findMemberNameBySession(swarm: SwarmState, sessionID: string): string | undefined {
  for (const member of Object.values(swarm.members)) {
    if (member.sessionID === sessionID) return member.name;
  }
  return undefined;
}

const OmocSwarmPlugin: Plugin = async ({ client }) => {
  const schema = tool.schema;

  const defaultMembers: SwarmMemberConfig[] = [
    { name: "planner", agent: "plan" },
    { name: "researcher", agent: "explore" },
    { name: "coder", agent: "build" },
    { name: "reviewer", agent: "general" },
  ];

  return {
    config: async (cfg) => {
      latestConfig = cfg;
    },
    tool: {
      "swarm.discover": tool({
        description:
          "Discover and register a swarm from existing session titles (expects titles like '<swarmId>:<memberName>' under the same parent).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id override"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          return formatSwarm(result.swarm);
        },
      }),

      "swarm.create": tool({
        description:
          "Create a multi-agent swarm (separate sessions) that can run in parallel and message each other via swarm.send.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id"),
          title: schema.string().min(1).optional().describe("Optional session title prefix"),
          members: schema
            .array(
              schema.object({
                name: schema.string().min(1).describe("Swarm member name (used for routing)"),
                agent: schema.string().min(1).describe("OpenCode agent id (e.g., plan, build, explore, general)"),
              }),
            )
            .optional()
            .describe("Optional custom members list"),
        },
        async execute(args, context) {
          const swarmId = args.id ?? createSwarmId();
          if (swarms.has(swarmId)) return `Error: swarm already exists: ${swarmId}`;

          const memberConfigs = (args.members?.length ? args.members : defaultMembers).map((m) => ({
            name: normalizeMemberName(m.name),
            agent: m.agent.trim(),
          }));

          const duplicate = memberConfigs.find(
            (m, idx) => memberConfigs.findIndex((x) => x.name === m.name) !== idx,
          );
          if (duplicate) return `Error: duplicate member name: ${duplicate.name}`;

          const swarm: SwarmState = {
            id: swarmId,
            directory: context.directory,
            worktree: context.worktree,
            createdAt: Date.now(),
            createdBySessionID: context.sessionID,
            members: {},
          };

          // Allow omitting swarmId on later calls from the "root" session.
          swarmBySessionID.set(context.sessionID, swarmId);

          for (const member of memberConfigs) {
            const titlePrefix = args.title?.trim() || swarmId;
            const session = await must<{ id: string }>(`create session for ${member.name}`, client.session.create({
              query: { directory: context.directory },
              body: {
                parentID: context.sessionID,
                title: `${titlePrefix}:${member.name}`,
              },
            }));

            swarm.members[member.name] = { ...member, sessionID: session.id };
            swarmBySessionID.set(session.id, swarmId);
          }

          swarms.set(swarmId, swarm);

          return formatSwarm(swarm);
        },
      }),

      "swarm.status": tool({
        description: "Show swarm status (members, sessions).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          return formatSwarm(result.swarm);
        },
      }),

      "swarm.parallel": tool({
        description:
          "Run the same prompt across multiple swarm members in parallel (with model-collision gating). Returns a combined report.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
          prompt: schema.string().min(1).describe("Prompt to send"),
          targets: schema.array(schema.string().min(1)).optional().describe("Optional list of member names to run"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarm = result.swarm;

          const targetNames = (args.targets?.length ? args.targets : Object.keys(swarm.members)).map(
            normalizeMemberName,
          );
          const targets: SwarmMember[] = [];
          for (const name of targetNames) {
            const member = swarm.members[name];
            if (!member) return `Error: unknown member '${name}'. Known: ${Object.keys(swarm.members).join(", ")}`;
            targets.push(member);
          }

          const groups = groupMembersByModel(targets);

          const resultsByMember = new Map<string, string>();
          await Promise.all(
            Array.from(groups.entries()).map(async ([modelKey, group]) => {
              // Same-model group executes sequentially to avoid provider/model collisions.
              for (const member of group) {
                const memberPrompt = [
                  `You are '${member.name}' (agent '${member.agent}') in swarm '${swarm.id}'.`,
                  `If you need to coordinate, use tool swarm.send.`,
                  "",
                  args.prompt,
                ].join("\n");

                const response = await must<{ parts: Array<any> }>(
                  `prompt ${member.name}`,
                  client.session.prompt({
                    query: { directory: swarm.directory },
                    path: { id: member.sessionID },
                    body: {
                      agent: member.agent,
                      parts: [{ type: "text", text: memberPrompt }],
                    },
                  }),
                );

                resultsByMember.set(member.name, extractText(response.parts) || "(no text output)");
              }
            }),
          );

          const header =
            groups.size === 1
              ? `Note: ran sequentially due to model collision (${Array.from(groups.keys()).join(", ")}).`
              : "";

          const combined = targetNames
            .map((name) => {
              const text = resultsByMember.get(name) ?? "(missing)";
              return [`### ${name}`, text].join("\n");
            })
            .join("\n\n");

          return [header, combined].filter(Boolean).join("\n\n");
        },
      }),

      "swarm.send": tool({
        description:
          "Send a message to another swarm member (routes as a prompt into their session). Optionally waits for their reply.",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
          to: schema.string().min(1).describe("Target member name"),
          message: schema.string().min(1).describe("Message to deliver"),
          awaitReply: schema.boolean().optional().describe("Wait for the target member to reply (default true)"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarm = result.swarm;

          const toName = normalizeMemberName(args.to);
          const target = swarm.members[toName];
          if (!target) return `Error: unknown member '${toName}'. Known: ${Object.keys(swarm.members).join(", ")}`;

          const fromName = findMemberNameBySession(swarm, context.sessionID) ?? context.agent;
          const awaitReply = args.awaitReply ?? true;

          const payload = [
            `SWARM MESSAGE (${swarm.id})`,
            `from: ${fromName}`,
            `to: ${toName}`,
            "",
            args.message,
            "",
            awaitReply ? `Reply back with swarm.send(to='${fromName}', message=...) if needed.` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const response = await must<{ parts: Array<any> }>(
            `send to ${toName}`,
            client.session.prompt({
              query: { directory: swarm.directory },
              path: { id: target.sessionID },
              body: {
                agent: target.agent,
                parts: [{ type: "text", text: payload }],
              },
            }),
          );

          if (!awaitReply) return `Sent to ${toName}.`;

          const text = extractText(response.parts) || "(no text output)";
          return [`Reply from ${toName}:`, text].join("\n\n");
        },
      }),

      "swarm.forget": tool({
        description: "Forget swarm state in this process (does not delete sessions).",
        args: {
          id: schema.string().min(1).optional().describe("Optional swarm id; defaults to current session's swarm"),
        },
        async execute(args, context) {
          const result = await resolveSwarm(client, args.id, context.sessionID, context.directory, context.worktree);
          if ("error" in result) return result.error;
          const swarmId = result.swarmId;
          const swarm = result.swarm;

          swarms.delete(swarmId);
          swarmBySessionID.delete(context.sessionID);
          for (const member of Object.values(swarm.members)) swarmBySessionID.delete(member.sessionID);

          return `Forgot swarm ${swarmId}. (Sessions remain; re-create mapping with swarm.create.)`;
        },
      }),
    },
  };
};

export default OmocSwarmPlugin;
