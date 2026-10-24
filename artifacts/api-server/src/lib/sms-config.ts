export type SmsEnvironment = {
  AFRICAS_TALKING_API_KEY?: string;
  AFRICAS_TALKING_USERNAME?: string;
  AFRICAS_TALKING_SENDER_ID?: string;
};

export type LiveSmsCredentials = {
  apiKey: string;
  username: string;
  senderId: string;
};

/** No sandbox or default sender fallback: missing live settings pause sending. */
export function getSmsPublicConfiguration(env: SmsEnvironment = process.env) {
  const username = env.AFRICAS_TALKING_USERNAME?.trim() ?? "";
  const senderId = env.AFRICAS_TALKING_SENDER_ID?.trim() ?? "";
  const missingSettings: string[] = [];
  if (!env.AFRICAS_TALKING_API_KEY?.trim()) missingSettings.push("API key");
  if (!username || username.toLowerCase() === "sandbox") missingSettings.push("Live app username");
  if (!senderId || senderId.length > 11 || /[\r\n]/.test(senderId)) missingSettings.push("Approved sender ID (up to 11 characters)");
  return {
    mode: "live" as const,
    configured: missingSettings.length === 0,
    username: username || null,
    senderId: senderId || null,
    missingSettings,
  };
}

export function getLiveSmsCredentials(env: SmsEnvironment = process.env): LiveSmsCredentials | null {
  const config = getSmsPublicConfiguration(env);
  if (!config.configured) return null;
  return {
    apiKey: env.AFRICAS_TALKING_API_KEY!.trim(),
    username: config.username!,
    senderId: config.senderId!,
  };
}
