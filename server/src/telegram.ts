import { getSettings } from "./settings.js";

/** Never include the token in errors or logs. */
function scrub(msg: string, token: string) {
  return token ? msg.split(token).join("<bot-token>") : msg;
}

async function tg(method: string, body: Record<string, unknown> | null, tokenOverride?: string) {
  const token = tokenOverride ?? getSettings().telegram.bot_token;
  if (!token) throw new Error("Telegram bot token is not set");
  try {
    const res = await fetch(`${process.env.TELEGRAM_API_BASE || "https://api.telegram.org"}/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
    if (!res.ok || !json.ok) throw new Error(`Telegram ${method} failed: ${json.description || res.status}`);
    return json.result;
  } catch (err) {
    throw new Error(scrub((err as Error).message, token));
  }
}

export async function sendTelegram(text: string, chatId?: string, buttons?: { text: string; url: string }[][]) {
  const s = getSettings().telegram;
  const chat = chatId || s.chat_id;
  if (!chat) throw new Error("Telegram chat ID is not set");
  const body: Record<string, unknown> = { chat_id: chat, text, disable_web_page_preview: true };
  // URL buttons only (deep links into Hearth): no callback handling, so nothing polls Telegram and the token stays server-side
  if (buttons?.length) body.reply_markup = { inline_keyboard: buttons };
  await tg("sendMessage", body);
}

/** Recent chats that messaged the bot (for the "Detect chat ID" button). Returns ids and names only. */
export async function detectChats() {
  const updates = (await tg("getUpdates", { limit: 50, timeout: 0 })) as Array<Record<string, unknown>>;
  const seen = new Map<string, { id: string; type: string; name: string }>();
  for (const u of updates || []) {
    const msg = (u.message || u.channel_post || u.my_chat_member || u.edited_message) as Record<string, unknown> | undefined;
    const chat = msg?.chat as Record<string, unknown> | undefined;
    if (!chat?.id) continue;
    const name = String(chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "");
    seen.set(String(chat.id), { id: String(chat.id), type: String(chat.type || ""), name });
  }
  return [...seen.values()];
}

export async function botInfo() {
  const me = (await tg("getMe", null)) as { username?: string; first_name?: string };
  return { username: me?.username ?? null, name: me?.first_name ?? null };
}
