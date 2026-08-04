// Maps the internal agent field values ('claude' | 'openai' | 'copilot' |
// 'antigravity') to the user-facing agent names. The stored values never
// change — this is display only.
export const AGENT_DISPLAY: Record<string, { name: string; colour: string }> = {
  claude: { name: "Raptia", colour: "#1a4fd6" },
  openai: { name: "Fovea", colour: "#3a6cf0" },
  copilot: { name: "Fovea", colour: "#3a6cf0" },
  antigravity: { name: "Raptia", colour: "#1a4fd6" },
};

export function agentDisplay(agent: string): { name: string; colour: string } {
  return AGENT_DISPLAY[agent] ?? { name: agent, colour: "#6b737d" };
}
