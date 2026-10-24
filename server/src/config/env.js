const isTest = process.env.NODE_ENV === 'test';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value && !isTest) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isTest,
  port: Number(process.env.PORT) || 5000,
  // Number of proxies in front of the API (Azure App Service = 1).
  trustProxy: Number(process.env.TRUST_PROXY) || 1,
  mongoUri: process.env.MONGODB_URI,
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  jwtSecret: required('JWT_SECRET', isTest ? 'test-secret' : undefined),
  cookieName: process.env.COOKIE_NAME || 'unio_session',
  // AI Brief Builder. Optional: without a key the endpoint returns a labelled template draft.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  briefModel: process.env.BRIEF_AI_MODEL || 'claude-opus-5-5',
  // Azure OpenAI (Foundry) through its OpenAI-compatible /openai/v1 endpoint; the model is the deployment name.
  // Used when ANTHROPIC_API_KEY is not set. Needs the endpoint, key and deployment together.
  azureOpenaiEndpoint: (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, ''),
  azureOpenaiApiKey: process.env.AZURE_OPENAI_API_KEY || '',
  azureOpenaiDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || '',
  // OpenAI: used when neither ANTHROPIC_API_KEY nor Azure OpenAI is set. The model has no default; set OPENAI_MODEL with the key.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || '',
  // Google Gemini (OpenAI-compatible endpoint): used when neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set.
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  // DeepSeek (OpenAI-compatible API): used when neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  // Alternative provider: used only when neither ANTHROPIC_API_KEY nor DEEPSEEK_API_KEY is set.
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openRouterModel: process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-5.5',
  // Azure Blob Storage for uploads (Phase 10). Optional until uploads are enabled.
  azureStorageAccount: process.env.AZURE_STORAGE_ACCOUNT || '',
  azureStorageKey: process.env.AZURE_STORAGE_KEY || '',
  azureStorageContainer: process.env.AZURE_STORAGE_CONTAINER || 'media',
  azureStoragePublicBase: process.env.AZURE_STORAGE_PUBLIC_BASE || '',
  // Public URL of the site, used to build links (e.g. agency approval links, Phase 9).
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5173').trim().replace(/\/$/, ''),
  // Comma-separated DNS servers used when the OS resolver cannot answer SRV lookups (common on Windows).
  dnsServers: (process.env.DNS_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean),
};
