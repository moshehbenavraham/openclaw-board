import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { OPENCLAW_CONFIG_PATH, OPENCLAW_HOME } from "@/lib/openclaw-paths";
const CONFIG_PATH = OPENCLAW_CONFIG_PATH;
const QQBOT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQBOT_API_BASE = "https://api.sgroup.qq.com";

interface PlatformTestResult {
  agentId: string;
  platform: string;
  accountId?: string;
  ok: boolean;
  detail?: string;
  error?: string;
  elapsed: number;
}

function runOpenClawMessageSend(channel: string, target: string, message: string, extraArgs: string[] = []): string {
  const args = [
    "message", "send",
    "--channel", channel,
    "-t", target,
    "--message", message,
    "--json",
    ...extraArgs,
  ];

  return execFileSync("openclaw", args, {
    timeout: 30000,
    encoding: "utf-8",
    env: { ...process.env },
  });
}

function runCurlJson(url: string, options: { method?: string; headers?: string[]; body?: string; timeoutSec?: number } = {}): { status: number; data: any; raw: string } {
  const args = [
    '-sS',
    '--connect-timeout', String(options.timeoutSec ?? 10),
    '--max-time', String(options.timeoutSec ?? 20),
    '-X', options.method || 'GET',
  ];

  for (const header of options.headers || []) {
    args.push('-H', header);
  }
  if (typeof options.body === 'string') {
    args.push('--data-raw', options.body);
  }
  args.push('-w', '\\n%{http_code}', url);

  const raw = execFileSync('curl', args, {
    timeout: (options.timeoutSec ?? 20) * 1000 + 1000,
    encoding: 'utf-8',
    env: { ...process.env },
  });
  const cut = raw.lastIndexOf('\n');
  const body = cut >= 0 ? raw.slice(0, cut) : raw;
  const status = Number(cut >= 0 ? raw.slice(cut + 1).trim() : 0);
  let data: any = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = null;
  }
  return { status, data, raw: body };
}

// Find the most recent feishu DM user open_id for a given agent
// Each feishu app has its own open_id namespace, so we must use per-agent open_ids
function getFeishuDmUser(agentId: string): string | null {
  try {
    const sessionsPath = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const sessions = JSON.parse(raw);
    let bestId: string | null = null;
    let bestTime = 0;
    for (const [key, val] of Object.entries(sessions)) {
      const m = key.match(/^agent:[^:]+:feishu:direct:(ou_[a-f0-9]+)$/);
      if (m) {
        const updatedAt = (val as any).updatedAt || 0;
        if (updatedAt > bestTime) {
          bestTime = updatedAt;
          bestId = m[1];
        }
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

// Feishu: get token → verify bot info → send a real DM
async function testFeishu(
  agentId: string,
  accountId: string,
  appId: string,
  appSecret: string,
  domain: string,
  testUserId: string | null
): Promise<PlatformTestResult> {
  const baseUrl = domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
  const startTime = Date.now();

  try {
    // Step 1: get tenant_access_token
    const tokenResp = await fetch(
      `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal: AbortSignal.timeout(15000),
      }
    );

    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
      return {
        agentId, platform: "feishu", accountId, ok: false,
        error: `Token failed: ${tokenData.msg || JSON.stringify(tokenData)}`,
        elapsed: Date.now() - startTime,
      };
    }

    const token = tokenData.tenant_access_token;

    // Step 2: verify bot info
    const botResp = await fetch(`${baseUrl}/open-apis/bot/v3/info/`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    const botData = await botResp.json();
    if (botData.code !== 0 || !botData.bot) {
      return {
        agentId, platform: "feishu", accountId, ok: false,
        error: `Bot API error: ${botData.msg || JSON.stringify(botData)}`,
        elapsed: Date.now() - startTime,
      };
    }

    const botName = botData.bot.bot_name || accountId;

    // Step 3: send a real DM to test user
    if (!testUserId) {
      return {
        agentId, platform: "feishu", accountId, ok: true,
        detail: `${botName} (bot reachable, no DM session found)`,
        elapsed: Date.now() - startTime,
      };
    }

    const now = new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" });
    const msgResp = await fetch(
      `${baseUrl}/open-apis/im/v1/messages?receive_id_type=open_id`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: testUserId,
          msg_type: "text",
          content: JSON.stringify({ text: `[Platform Test] ${botName} 联通测试 ✅ (${now})` }),
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    const msgData = await msgResp.json();
    const elapsed = Date.now() - startTime;

    if (msgData.code === 0) {
      return {
        agentId, platform: "feishu", accountId, ok: true,
        detail: `${botName} → DM sent (${elapsed}ms)`,
        elapsed,
      };
    } else {
      return {
        agentId, platform: "feishu", accountId, ok: false,
        error: `Send DM failed: ${msgData.msg || JSON.stringify(msgData)}`,
        elapsed,
      };
    }
  } catch (err: any) {
    return {
      agentId, platform: "feishu", accountId, ok: false,
      error: err.message,
      elapsed: Date.now() - startTime,
    };
  }
}

// Discord: use curl so the host proxy settings are honored consistently
async function testDiscord(
  agentId: string,
  botToken: string,
  testUserId: string | null,
  recipientSource: "session" | "allowFrom" | "none"
): Promise<PlatformTestResult> {
  const startTime = Date.now();

  try {
    const meResp = runCurlJson('https://discord.com/api/v10/users/@me', {
      headers: [`Authorization: Bot ${botToken}`],
      timeoutSec: 15,
    });
    const meData = meResp.data;
    if (meResp.status < 200 || meResp.status >= 300 || !meData?.id) {
      return {
        agentId, platform: 'discord', ok: false,
        error: `Discord API error: ${meData?.message || meResp.raw || `HTTP ${meResp.status}`}`,
        elapsed: Date.now() - startTime,
      };
    }

    const botName = `${meData.username}#${meData.discriminator || '0'}`;

    if (!testUserId) {
      return {
        agentId, platform: 'discord', ok: true,
        detail: `${botName} (bot reachable, no test user for DM)`,
        elapsed: Date.now() - startTime,
      };
    }

    const dmChanResp = runCurlJson('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: [
        `Authorization: Bot ${botToken}`,
        'Content-Type: application/json',
      ],
      body: JSON.stringify({ recipient_id: testUserId }),
      timeoutSec: 15,
    });
    const dmChan = dmChanResp.data;
    if (dmChanResp.status < 200 || dmChanResp.status >= 300 || !dmChan?.id) {
      return {
        agentId, platform: 'discord', ok: false,
        error: `Create DM channel failed: ${dmChan?.message || dmChanResp.raw || `HTTP ${dmChanResp.status}`}`,
        elapsed: Date.now() - startTime,
      };
    }

    const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const msgResp = runCurlJson(`https://discord.com/api/v10/channels/${dmChan.id}/messages`, {
      method: 'POST',
      headers: [
        `Authorization: Bot ${botToken}`,
        'Content-Type: application/json',
      ],
      body: JSON.stringify({
        content: `[Platform Test] ${botName} connectivity test ✅ (${now})`,
        flags: 4096,
      }),
      timeoutSec: 15,
    });
    const msgData = msgResp.data;
    const elapsed = Date.now() - startTime;
    if (msgResp.status >= 200 && msgResp.status < 300 && msgData?.id) {
      const sourceLabel = recipientSource === 'allowFrom' ? 'allowFrom' : 'session';
      return {
        agentId, platform: 'discord', ok: true,
        detail: `${botName} → DM sent (${elapsed}ms, via ${sourceLabel})`,
        elapsed,
      };
    }

    return {
      agentId, platform: 'discord', ok: false,
      error: `Send DM failed: ${msgData?.message || msgResp.raw || `HTTP ${msgResp.status}`}`,
      elapsed,
    };
  } catch (err: any) {
    return {
      agentId, platform: 'discord', ok: false,
      error: err.stderr || err.message || 'Unknown error',
      elapsed: Date.now() - startTime,
    };
  }
}

function getDiscordDmUser(agentId: string): string | null {
  try {
    const sessionsPath = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const sessions = JSON.parse(raw);
    let bestId: string | null = null;
    let bestTime = 0;
    for (const [key, val] of Object.entries(sessions)) {
      const m = key.match(/^agent:[^:]+:discord:direct:(.+)$/);
      if (m) {
        const updatedAt = (val as any).updatedAt || 0;
        if (updatedAt > bestTime) {
          bestTime = updatedAt;
          bestId = m[1];
        }
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

function getDiscordAllowlistUser(discordConfig: any): string | null {
  const list = Array.isArray(discordConfig?.allowFrom)
    ? discordConfig.allowFrom
    : Array.isArray(discordConfig?.dm?.allowFrom)
      ? discordConfig.dm.allowFrom
      : [];
  const first = list.find((v: any) => typeof v === "string" && v.trim().length > 0);
  return first ? first.trim() : null;
}

// Find the most recent telegram DM chat_id for a given agent
function getTelegramDmUser(agentId: string): string | null {
  try {
    const sessionsPath = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const sessions = JSON.parse(raw);
    let bestId: string | null = null;
    let bestTime = 0;
    for (const [key, val] of Object.entries(sessions)) {
      const m = key.match(/^agent:[^:]+:telegram:direct:(.+)$/);
      if (m) {
        const updatedAt = (val as any).updatedAt || 0;
        if (updatedAt > bestTime) {
          bestTime = updatedAt;
          bestId = m[1];
        }
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

// Telegram: send a real DM through local OpenClaw channel gateway
async function testTelegram(
  agentId: string,
  testChatId: string | null
): Promise<PlatformTestResult> {
  const startTime = Date.now();

  if (!testChatId) {
    return {
      agentId, platform: "telegram", ok: false,
      error: "No Telegram recipient configured. Start one DM session first",
      elapsed: Date.now() - startTime,
    };
  }

  try {
    const now = new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" });
    const result = runOpenClawMessageSend(
      "telegram",
      testChatId,
      `[Platform Test] Telegram 联通测试 ✅ (${now})`,
      ["--silent"]
    );
    const elapsed = Date.now() - startTime;
    const outputSummary = result.trim().slice(0, 120);
    return {
      agentId, platform: "telegram", ok: true,
      detail: `Telegram → DM sent to ${testChatId} (${elapsed}ms)${outputSummary ? ` · ${outputSummary}` : ""}`,
      elapsed,
    };
  } catch (err: any) {
    return {
      agentId, platform: "telegram", ok: false,
      error: (err.stderr || err.message || "Unknown error").slice(0, 300),
      elapsed: Date.now() - startTime,
    };
  }
}

// Find the most recent whatsapp DM user for a given agent
function getWhatsappDmUser(agentId: string): string | null {
  try {
    const sessionsPath = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const sessions = JSON.parse(raw);
    let bestId: string | null = null;
    let bestTime = 0;
    for (const [key, val] of Object.entries(sessions)) {
      const m = key.match(/^agent:[^:]+:whatsapp:direct:(.+)$/);
      if (m) {
        const updatedAt = (val as any).updatedAt || 0;
        if (updatedAt > bestTime) {
          bestTime = updatedAt;
          bestId = m[1];
        }
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

function getWhatsappAllowlistUser(whatsappConfig: any): string | null {
  const list = Array.isArray(whatsappConfig?.allowFrom)
    ? whatsappConfig.allowFrom
    : Array.isArray(whatsappConfig?.dm?.allowFrom)
      ? whatsappConfig.dm.allowFrom
      : [];
  const first = list.find((v: any) => typeof v === "string" && v.trim().length > 0);
  return first ? first.trim() : null;
}

// Find the most recent qqbot DM user for a given agent
function getQqbotDmUser(agentId: string): string | null {
  try {
    const sessionsPath = path.join(OPENCLAW_HOME, `agents/${agentId}/sessions/sessions.json`);
    const raw = fs.readFileSync(sessionsPath, "utf-8");
    const sessions = JSON.parse(raw);
    let bestId: string | null = null;
    let bestTime = 0;
    for (const [key, val] of Object.entries(sessions)) {
      const m = key.match(/^agent:[^:]+:qqbot:direct:(.+)$/);
      if (m) {
        const updatedAt = (val as any).updatedAt || 0;
        if (updatedAt > bestTime) {
          bestTime = updatedAt;
          bestId = m[1];
        }
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

function getQqbotAllowlistUser(qqbotConfig: any): string | null {
  const list = Array.isArray(qqbotConfig?.allowFrom)
    ? qqbotConfig.allowFrom
    : Array.isArray(qqbotConfig?.dm?.allowFrom)
      ? qqbotConfig.dm.allowFrom
      : [];
  const first = list.find((v: any) => typeof v === "string" && v.trim().length > 0);
  return first ? first.trim() : null;
}

function normalizeQqbotTarget(target: string | null): string | null {
  if (!target) return null;
  const raw = target.trim();
  if (!raw || raw === "*") return null;

  const full = raw.match(/^qqbot:(c2c|group|channel):(.+)$/i);
  if (full) {
    return `qqbot:${full[1].toLowerCase()}:${full[2].toUpperCase()}`;
  }

  const typed = raw.match(/^(c2c|group|channel):(.+)$/i);
  if (typed) {
    return `qqbot:${typed[1].toLowerCase()}:${typed[2].toUpperCase()}`;
  }

  return `qqbot:c2c:${raw.toUpperCase()}`;
}

function resolveQqbotCredentials(qqbotConfig: any): { accountId: string; appId: string; clientSecret: string } | null {
  if (!qqbotConfig || qqbotConfig.enabled === false) return null;

  if (
    typeof qqbotConfig.appId === "string" &&
    qqbotConfig.appId.trim() &&
    typeof qqbotConfig.clientSecret === "string" &&
    qqbotConfig.clientSecret.trim()
  ) {
    return {
      accountId: "default",
      appId: qqbotConfig.appId.trim(),
      clientSecret: qqbotConfig.clientSecret.trim(),
    };
  }

  const accounts = qqbotConfig.accounts;
  if (!accounts || typeof accounts !== "object") return null;

  const candidates = [
    qqbotConfig.defaultAccount,
    ...Object.keys(accounts),
  ].filter((v) => typeof v === "string" && v.trim().length > 0) as string[];

  for (const accountId of candidates) {
    const acc = accounts[accountId];
    if (
      acc &&
      typeof acc.appId === "string" &&
      acc.appId.trim() &&
      typeof acc.clientSecret === "string" &&
      acc.clientSecret.trim()
    ) {
      return {
        accountId,
        appId: acc.appId.trim(),
        clientSecret: acc.clientSecret.trim(),
      };
    }
  }

  return null;
}

async function getQqbotAccessToken(appId: string, clientSecret: string): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const resp = await fetch(QQBOT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret }),
      signal: AbortSignal.timeout(15000),
    });
    const raw = await resp.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }

    if (!resp.ok) {
      return { ok: false, error: `Token API HTTP ${resp.status}: ${(raw || "").slice(0, 180)}` };
    }
    if (!data?.access_token) {
      return { ok: false, error: `Token API invalid response: ${(raw || "").slice(0, 180)}` };
    }

    return { ok: true, token: data.access_token };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Token API request failed" };
  }
}

async function testWhatsapp(
  agentId: string,
  gatewayPort: number,
  gatewayToken: string,
  testUserId: string | null,
  recipientSource: "session" | "allowFrom" | "none"
): Promise<PlatformTestResult> {
  const startTime = Date.now();

  if (!testUserId) {
    return {
      agentId, platform: "whatsapp", ok: false,
      error: "No WhatsApp recipient configured. Set channels.whatsapp.allowFrom or start one DM session first",
      elapsed: Date.now() - startTime,
    };
  }

  try {
    const now = new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" });
    const result = runOpenClawMessageSend(
      "whatsapp",
      testUserId,
      `[Platform Test] WhatsApp 联通测试 ✅ (${now})`
    );

    const elapsed = Date.now() - startTime;
    const sourceLabel = recipientSource === "allowFrom" ? "allowFrom" : "session";
    const outputSummary = result.trim().slice(0, 120);
    return {
      agentId, platform: "whatsapp", ok: true,
      detail: `WhatsApp → DM sent to ${testUserId} (${elapsed}ms, via ${sourceLabel})${outputSummary ? ` · ${outputSummary}` : ""}`,
      elapsed,
    };
  } catch (err: any) {
    return {
      agentId, platform: "whatsapp", ok: false,
      error: (err.stderr || err.message || "Unknown error").slice(0, 300),
      elapsed: Date.now() - startTime,
    };
  }
}

async function testQqbot(
  agentId: string,
  qqbotConfig: any,
  testUserId: string | null,
  recipientSource: "session" | "allowFrom" | "none"
): Promise<PlatformTestResult> {
  const startTime = Date.now();
  const creds = resolveQqbotCredentials(qqbotConfig);
  if (!creds) {
    return {
      agentId, platform: "qqbot", ok: false,
      error: "QQBot credentials missing. Configure channels.qqbot.appId/clientSecret (or accounts)",
      elapsed: Date.now() - startTime,
    };
  }

  const tokenResult = await getQqbotAccessToken(creds.appId, creds.clientSecret);
  if (!tokenResult.ok || !tokenResult.token) {
    return {
      agentId, platform: "qqbot", ok: false,
      error: tokenResult.error || "QQBot token probe failed",
      elapsed: Date.now() - startTime,
    };
  }

  if (!testUserId) {
    return {
      agentId, platform: "qqbot", ok: true,
      detail: `QQBot token OK (account ${creds.accountId}, no DM session found)`,
      elapsed: Date.now() - startTime,
    };
  }

  try {
    const now = new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" });
    const target = testUserId.replace(/^qqbot:/i, "");
    const [kindRaw, ...idParts] = target.split(":");
    const kind = kindRaw.toLowerCase();
    const targetId = idParts.join(":");
    if (!targetId) {
      return {
        agentId, platform: "qqbot", ok: false,
        error: `Invalid QQBot target: ${testUserId}`,
        elapsed: Date.now() - startTime,
      };
    }

    const url = kind === "group"
      ? `${QQBOT_API_BASE}/v2/groups/${targetId}/messages`
      : kind === "channel"
        ? `${QQBOT_API_BASE}/channels/${targetId}/messages`
        : `${QQBOT_API_BASE}/v2/users/${targetId}/messages`;

    const body = kind === "channel"
      ? { content: `[Platform Test] QQBot 联通测试 ✅ (${now})` }
      : { content: `[Platform Test] QQBot 联通测试 ✅ (${now})`, msg_type: 0 };

    const msgResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${tokenResult.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const raw = await msgResp.text();

    const elapsed = Date.now() - startTime;
    const sourceLabel = recipientSource === "allowFrom" ? "allowFrom" : "session";
    if (!msgResp.ok) {
      return {
        agentId, platform: "qqbot", ok: false,
        error: `Send failed HTTP ${msgResp.status}: ${(raw || "").slice(0, 180)}`,
        elapsed,
      };
    }

    return {
      agentId, platform: "qqbot", ok: true,
      detail: `QQBot → DM sent to ${testUserId} (${elapsed}ms, via ${sourceLabel})`,
      elapsed,
    };
  } catch (err: any) {
    return {
      agentId, platform: "qqbot", ok: false,
      error: (err.stderr || err.message || "Unknown error").slice(0, 300),
      elapsed: Date.now() - startTime,
    };
  }
}

export async function POST() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);

    const bindings = config.bindings || [];
    const channels = config.channels || {};
    const feishuConfig = channels.feishu || {};
    const feishuAccounts = feishuConfig.accounts || {};
    const feishuDomain = feishuConfig.domain || "feishu";
    const discordConfig = channels.discord || {};
    const telegramConfig = channels.telegram || {};
    const whatsappConfig = channels.whatsapp || {};
    const qqbotConfig = channels.qqbot;

    // Read gateway config early (needed for WhatsApp test)
    const gatewayPort = config.gateway?.port || 18789;
    const gatewayToken = config.gateway?.auth?.token || "";

    let agentList = config.agents?.list || [];
    if (agentList.length === 0) {
      try {
        const agentsDir = path.join(OPENCLAW_HOME, "agents");
        const dirs = fs.readdirSync(agentsDir, { withFileTypes: true });
        agentList = dirs
          .filter((d: any) => d.isDirectory() && !d.name.startsWith("."))
          .map((d: any) => ({ id: d.name }));
      } catch {}
      if (agentList.length === 0) {
        agentList = [{ id: "main" }];
      }
    }

    // Phase 1: Feishu API tests can run in parallel.
    // Local gateway / CLI-backed channel tests are run sequentially to avoid send-path contention.
    const platformTests: Promise<PlatformTestResult>[] = [];
    const sequentialPlatformTests: Array<() => Promise<PlatformTestResult>> = [];
    const testedFeishuAccounts = new Set<string>();

    for (const agent of agentList) {
      const id = agent.id;

      // Feishu
      const feishuBinding = bindings.find(
        (b: any) => b.agentId === id && b.match?.channel === "feishu"
      );
      const accountId = feishuBinding?.match?.accountId || id;
      const account = feishuAccounts[accountId];

      if (account && account.appId && account.appSecret && !testedFeishuAccounts.has(accountId)) {
        testedFeishuAccounts.add(accountId);
        const testUserId = getFeishuDmUser(id);
        platformTests.push(testFeishu(id, accountId, account.appId, account.appSecret, feishuDomain, testUserId));
      } else if (!feishuBinding && !account) {
        if (id === "main" && feishuConfig.enabled && feishuConfig.appId && feishuConfig.appSecret && !testedFeishuAccounts.has("main")) {
          testedFeishuAccounts.add("main");
          const testUserId = getFeishuDmUser("main");
          platformTests.push(testFeishu(id, "main", feishuConfig.appId, feishuConfig.appSecret, feishuDomain, testUserId));
        }
      }

      // Discord: only test once, via local OpenClaw channel gateway
      if (id === "main" && discordConfig.enabled) {
        const recentDmUser = getDiscordDmUser(id);
        const allowFromUser = getDiscordAllowlistUser(discordConfig);
        const discordTestUser = recentDmUser || allowFromUser || null;
        const source: "session" | "allowFrom" | "none" =
          recentDmUser ? "session" : (allowFromUser ? "allowFrom" : "none");
        sequentialPlatformTests.push(() => testDiscord(id, discordConfig.token, discordTestUser, source));
      }

      // Telegram: only test once, via local OpenClaw channel gateway
      if (id === "main" && telegramConfig.enabled) {
        const telegramTestUser = getTelegramDmUser(id);
        sequentialPlatformTests.push(() => testTelegram(id, telegramTestUser));
      }

      // WhatsApp: only test once, via gateway
      if (id === "main" && whatsappConfig && whatsappConfig.enabled !== false) {
        const recentDmUser = getWhatsappDmUser(id);
        const allowFromUser = getWhatsappAllowlistUser(whatsappConfig);
        const whatsappTestUser = recentDmUser || allowFromUser || null;
        const source: "session" | "allowFrom" | "none" =
          recentDmUser ? "session" : (allowFromUser ? "allowFrom" : "none");
        sequentialPlatformTests.push(() => testWhatsapp(id, gatewayPort, gatewayToken, whatsappTestUser, source));
      }

      // QQBot: only test once, via `openclaw message send`
      if (id === "main" && qqbotConfig && qqbotConfig.enabled !== false) {
        const recentDmUser = normalizeQqbotTarget(getQqbotDmUser(id));
        const allowFromUser = normalizeQqbotTarget(getQqbotAllowlistUser(qqbotConfig));
        const qqbotTestUser = recentDmUser || allowFromUser || null;
        const source: "session" | "allowFrom" | "none" =
          recentDmUser ? "session" : (allowFromUser ? "allowFrom" : "none");
        sequentialPlatformTests.push(() => testQqbot(id, qqbotConfig, qqbotTestUser, source));
      }
    }

    const platformResults = await Promise.all(platformTests);
    for (const runTest of sequentialPlatformTests) {
      platformResults.push(await runTest());
    }

    return NextResponse.json({ results: platformResults });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}
