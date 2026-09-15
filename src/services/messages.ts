import type { Lang } from "./routing-algorithm.ts";

type MessageTemplates = Record<string, Record<Lang, string>>;

const MESSAGES: MessageTemplates = {
  roleDetected: {
    en: "Required role: {role}",
  },
  sizeEstimated: {
    en: "Problem size: {size}",
  },
  directRoutingDetected: {
    en: "Detected @{agent} — direct routing",
  },

  ambiguousRequest: {
    en: "What exactly do you need? Describe the task clearly.",
  },

  greeting: {
    en: "Hello! I'm Tawa, the smart dispatcher. How can I help?",
  },

  dangerousAction: {
    en: "⚠️ This is a dangerous action ({action}). Are you sure?",
  },
  apikeyShared: {
    en: "Don't share API keys with agents. Add them directly in settings.",
  },

  forbiddenSettings: {
    en: "I can't change settings. Edit opencode.json yourself.",
  },
  forbiddenPermissions: {
    en: "I can't grant additional permissions.",
  },

  agentUnavailable: {
    en: "Agent {agent} unavailable. Best alternative: {fallback}",
  },

  thinkingShallow: {
    en: "Shallow thinking",
  },
  thinkingModerate: {
    en: "Moderate thinking",
  },
  thinkingDeep: {
    en: "Deep thinking",
  },
  thinkingAnalyzeFirst: {
    en: "Analyze first",
  },

  tawaIntentUnderstood: {
    en: "Got it! You need {summary}. I'll route this to the {team}. Shall we proceed?",
  },
  tawaIntentUnclear: {
    en: "I didn't quite understand. Could you clarify? For example: 'fix a bug' or 'test the system'.",
  },
  tawaDispatchStart: {
    en: "Task sent to {team}. I'll notify you as soon as it's done... ⏳",
  },
  tawaDispatchParallel: {
    en: "I'll distribute this to multiple teams in parallel: {teams}. I'll collect the results.",
  },
  tawaProgressUpdate: {
    en: "{team} is still working on it... Thanks for your patience ⏳",
  },
  tawaResultSummary: {
    en: "✅ **Task complete!**\n\n{summary}\n\nIs there anything you'd like to adjust or add?",
  },
  tawaAgentBusy: {
    en: "This team is currently busy. I'll try an alternative... 🔄",
  },
  tawaAgentUnavailable: {
    en: "Sorry, {team} is currently unavailable. Would you like to try later or simplify the request?",
  },
  tawaAllAgentsBusy: {
    en: "All teams are busy right now. Please try again shortly or simplify your request.",
  },
  tawaTaskFailed: {
    en: "⚠️ The task didn't complete as planned. {reason}\n\nWould you like to:\n1. Try a different approach\n2. Simplify the request\n3. Talk to the analysis team for a plan",
  },
  tawaGoodbye: {
    en: "Alright, I'm here if you need me! Take care 👋",
  },

  tawaQueuePosition: {
    en: "Your request is queued. You're #{position} waiting for {team}. I'll notify you when it's your turn. ⏳",
  },
  tawaQueueEstimatedWait: {
    en: "Estimated wait time: about {minutes} minutes. Would you like to wait or try another team?",
  },
  tawaQueueDispatched: {
    en: "Your turn! Your request has been dispatched to {team}. 🚀",
  },
  tawaAgentAvailable: {
    en: "{team} is now available! Would you like to proceed with the pending task?",
  },
  tawaAgentHealthStatus: {
    en: "{team} status: {status}",
  },
  tawaNoAgentsAvailable: {
    en: "All teams are currently busy. Your request has been added to the queue and will be processed as soon as a team becomes available.",
  },
  statusAvailable: {
    en: "Available",
  },
  statusBusy: {
    en: "Busy",
  },
  statusPaused: {
    en: "Paused",
  },
  statusCircuitOpen: {
    en: "Unavailable (recovering)",
  },
  statusUnavailable: {
    en: "Unavailable",
  },

  modelRunning: {
    en: "🧠 Current model: {model}",
  },
  modelChanged: {
    en: "Switched to {model}",
  },
  modelFallback: {
    en: "Primary model unavailable, fell back to {model}",
  },
};

export function msg(key: string, lang: Lang, vars?: Record<string, string>): string {
  const template = MESSAGES[key]?.[lang] ?? MESSAGES[key]?.en ?? key;
  if (!vars) return template;
  let result = template;
  for (const [k, v] of Object.entries(vars)) {
    result = result.split(`{${k}}`).join(v);
  }
  return result;
}