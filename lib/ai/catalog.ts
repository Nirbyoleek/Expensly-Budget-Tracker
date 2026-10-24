/** The AI services people can connect, with plain setup steps. Safe to import in the browser. */
export type ProviderId = "gemini" | "openai" | "groq" | "anthropic" | "openrouter";

export type ProviderInfo = {
  id: ProviderId;
  name: string;
  brand: string;
  price: string;
  free: boolean;
  blurb: string;
  keyUrl: string;
  keyLabel: string;
  placeholder: string;
  steps: string[];
  privacy: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "gemini", name: "Gemini", brand: "Google", price: "Free tier", free: true,
    blurb: "Use your Google account. Free for personal use, no card needed.",
    keyUrl: "https://aistudio.google.com/apikey", keyLabel: "Open Google AI Studio", placeholder: "AIza…",
    steps: ["Open Google AI Studio and sign in with your Google account.", "Click “Create API key” and copy it.", "Paste it below."],
    privacy: "On Google's free tier, your questions and answers may be used to improve Google's products. Add billing in AI Studio to switch that off.",
  },
  {
    id: "openai", name: "ChatGPT", brand: "OpenAI", price: "Pay as you go",
    free: false,
    blurb: "Uses OpenAI's API. Separate from a ChatGPT Plus subscription; usually a few paise per question.",
    keyUrl: "https://platform.openai.com/api-keys", keyLabel: "Open OpenAI API keys", placeholder: "sk-…",
    steps: ["Sign in at platform.openai.com with your ChatGPT login.", "Add a little credit under Billing (a ChatGPT Plus plan doesn't include API use).", "Create a secret key, copy it and paste it below."],
    privacy: "OpenAI doesn't train on API data by default.",
  },
  {
    id: "groq", name: "Groq", brand: "Open models", price: "Free", free: true,
    blurb: "Fast open models (like gpt-oss). Free, no card, generous daily limit.",
    keyUrl: "https://console.groq.com/keys", keyLabel: "Open Groq console", placeholder: "gsk_…",
    steps: ["Sign up at console.groq.com (Google sign-in works).", "Go to API Keys → Create API key, and copy it.", "Paste it below."],
    privacy: "Groq doesn't keep request data by default.",
  },
  {
    id: "anthropic", name: "Claude", brand: "Anthropic", price: "Pay as you go", free: false,
    blurb: "Anthropic's Claude. The strongest at careful money analysis.",
    keyUrl: "https://console.anthropic.com/settings/keys", keyLabel: "Open Anthropic console", placeholder: "sk-ant-…",
    steps: ["Sign in at console.anthropic.com.", "Add credit under Billing, then create a key under API keys.", "Paste it below."],
    privacy: "Anthropic doesn't train on API data by default.",
  },
  {
    id: "openrouter", name: "OpenRouter", brand: "Many models", price: "Free models", free: true,
    blurb: "One key for hundreds of models, including free ones.",
    keyUrl: "https://openrouter.ai/settings/keys", keyLabel: "Open OpenRouter", placeholder: "sk-or-…",
    steps: ["Sign in at openrouter.ai.", "Create a key under Settings → Keys.", "Paste it below."],
    privacy: "Data handling depends on the model; free models may log prompts.",
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderInfo>;
