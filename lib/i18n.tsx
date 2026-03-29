"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";

export type Locale = "zh-TW" | "zh" | "en";

const englishTranslations: Record<string, string> = {
  // layout
  "site.title": "OpenClaw Bot Dashboard",
  "site.desc": "View all OpenClaw bot configurations",

  // nav sidebar
  "nav.overview": "Overview",
  "nav.agents": "Bots",
  "nav.models": "Models",
  "nav.monitor": "Monitor",
  "nav.sessions": "Sessions",
  "nav.stats": "Statistics",
  "nav.pixelOffice": "Pixel Office",
  "nav.config": "Config",
  "nav.skills": "Skills",
  "nav.alerts": "Alerts",
  "nav.experiments": "Experiments",
  "nav.expandSidebar": "Expand sidebar",
  "nav.collapseSidebar": "Collapse sidebar",
  "nav.bugsOn": "Bugs On",
  "nav.bugsOff": "Bugs Off",
  "nav.bugsCount": "Count",

  // alerts page
  "alerts.title": "Alert Center",
  "alerts.subtitle": "Configure system alerts and notifications",
  "alerts.enableAlerts": "Enable Alerts",
  "alerts.enableDesc": "Turn on or off all alert notifications",
  "alerts.receiveAgent": "Receive Alert Agent",
  "alerts.rules": "Alert Rules",
  "alerts.rulesDesc": "Configure which conditions trigger alerts",
  "alerts.triggered": "Alerts Triggered ({count})",
  "alerts.checking": "Checking alerts...",
  "alerts.checkNow": "Check Now",
  "alerts.checkInterval": "Check Interval",

  // common
  "common.loading": "thinking...",
  "common.loadError": "Failed to load",
  "common.backHome": "← Back to Home",
  "common.backOverview": "← Back to Overview",
  "common.noData": "No data",
  "common.close": "Close",
  "common.test": "🧪 Test",
  "common.testing": "⏳ Testing...",
  "common.justNow": "just now",
  "common.minutesAgo": "min ago",
  "common.hoursAgo": "hours ago",
  "common.daysAgo": "days ago",
  "common.manualRefresh": "Manual Refresh",
  "common.seconds": "seconds",
  "common.minute": "minute",
  "common.minutes": "minutes",

  // home page
  "home.title": "🐾 OpenClaw Bot Dashboard",
  "home.agentCount": "bots",
  "home.pageTitle": "OpenClaw Bots",
  "home.defaultModel": "Default model",
  "home.viewModels": "View Models →",
  "home.skillMgmt": "🧩 Skills",
  "home.testAll": "Test Bound Models",
  "home.testingAll": "Testing Models...",
  "home.testOk": "OK",
  "home.testFail": "Failed",
  "home.updatedAt": "Updated at",
  "home.refreshManual": "🔄 Manual Refresh",
  "home.globalTrend": "📊 Global Statistics",
  "home.totalInputToken": "Total Input Token",
  "home.totalOutputToken": "Total Output Token",
  "home.totalMessages": "Total Messages",
  "home.tokenTrend": "🔢 Token Usage Trend",
  "home.avgResponseTrend": "⏱️ Avg Response Time Trend",
  "home.groupTopology": "💬 Group Chat Topology",
  "home.fallbackModels": "🔄 Fallback Models",
  "home.feishuGroup": "Feishu Group",
  "home.discordChannel": "Discord Channel",
  "home.bots": "bots",
  "home.noResponseData": "No response time data",
  "home.testPlatforms": "Test Platforms",
  "home.testingPlatforms": "Testing Platforms...",
  "home.testSessions": "Test Agent Sessions",
  "home.testingSessions": "Testing Sessions...",
  "home.testDmSessions": "Test DM Sessions",
  "home.testingDmSessions": "Testing...",
  "home.agentTaskTracking": "Agent Task Tracking",
  "home.agentTaskSubtasks": "Subtasks",
  "home.agentTaskCron": "Cron Jobs",
  "home.agentTaskState.working": "Running",
  "home.agentTaskState.waiting": "Waiting",
  "home.agentTaskState.idle": "Idle",
  "home.agentTaskNoSubtasks": "No active subtasks",
  "home.agentTaskNoCron": "No cron activity",
  "home.agentTaskCronState.running": "Running",
  "home.agentTaskCronState.success": "Success",
  "home.agentTaskCronState.failed": "Failed",
  "home.agentTaskCronFailures": "Failures",
  "home.agentTaskCronNoSummary": "No summary",
  "home.agentTaskCronDuration": "Duration",
  "home.agentTaskCronNextRun": "Next run",

  // agent card
  "agent.model": "Model",
  "agent.platform": "Platform",
  "agent.feishuAppId": "Feishu App ID",
  "agent.sessionCount": "Sessions",
  "agent.messageCount": "Messages",
  "agent.tokenUsage": "Token Usage",
  "agent.totalTokenTip": "Total token usage",
  "agent.stats": "Stats",
  "agent.lastActive": "Last Active",
  "agent.todayAvgResponse": "Avg Response",
  "agent.todayAvgResponseTip": "Today's average response time",
  "agent.switchModel": "Switch Model",
  "agent.saveModel": "Save & Apply",
  "agent.cancelModel": "Cancel",
  "agent.modelSaving": "Applying...",
  "agent.modelApplyHint": "Saving will restart the Gateway automatically to apply the new model.",
  "agent.modelApplyFailed": "Failed to apply model",
  "agent.currentUnknownModel": "Current model (not in option list)",

  // agent status
  "agent.status.working": "Working",
  "agent.status.online": "Online",
  "agent.status.idle": "Idle",
  "agent.status.offline": "Offline",
  "agent.inUse": "Used by:",
  "agent.openChat": "Click to open chat",

  // platform
  "platform.feishu": "📱 Feishu",
  "platform.yuanbao": "🤖 Yuanbao",
  "platform.discord": "🎮 Discord",
  "platform.telegram": "✈️ Telegram",
  "platform.whatsapp": "💬 WhatsApp",
  "platform.qqbot": "🐧 QQBot",
  "platform.wecom": "💼 WeCom",

  // time range
  "range.daily": "Daily",
  "range.weekly": "Weekly",
  "range.monthly": "Monthly",

  // refresh options
  "refresh.manual": "Manual Refresh",
  "refresh.10s": "10s",
  "refresh.30s": "30s",
  "refresh.1m": "1 min",
  "refresh.5m": "5 min",
  "refresh.10m": "10 min",

  // models page
  "models.title": "OpenClaw Model List",
  "models.providerCount": "Providers",
  "models.totalPrefix": "",
  "models.testAll": "🧪 Test All Models",
  "models.testingAll": "⏳ Testing...",
  "models.colModelId": "Model ID",
  "models.colName": "Name",
  "models.colAccessMode": "Access Mode",
  "models.accessModeApiKey": "api_key",
  "models.accessModeAuth": "auth",
  "models.colContext": "Context Window",
  "models.colMaxOutput": "Max Output",
  "models.colInputType": "Input Type",
  "models.colReasoning": "Reasoning",
  "models.colInputToken": "Input Token",
  "models.colOutputToken": "Output Token",
  "models.colAvgResponse": "Avg Response",
  "models.colTest": "Test",
  "models.noExplicitModels": "No explicit model definitions (inferred from provider name)",
  "models.defaultModel": "Default Model",
  "models.fallbackModels": "Fallback Models",

  // stats page
  "stats.title": "Message Statistics",
  "stats.subtitle": "Token usage and response time analysis",
  "stats.totalInputToken": "Total Input Token",
  "stats.totalOutputToken": "Total Output Token",
  "stats.totalMessages": "Total Messages",
  "stats.dataPeriod": "Data Period",
  "stats.tokenConsumption": "🔢 Token Usage",
  "stats.avgResponseTime": "⏱️ Avg Response Time",
  "stats.sessionList": "📋 Sessions",
  "stats.home": "← Home",
  "stats.missingAgent": "Missing agent parameter",
  "stats.noResponseData": "No response time data",
  "stats.selectAgent": "Select an agent to view message statistics",
  "stats.backToAgents": "← Back to agents",

  // sessions page
  "sessions.title": "Sessions",
  "sessions.sessionCount": "sessions",
  "sessions.totalToken": "Total Token",
  "sessions.missingAgent": "Missing agent parameter",
  "sessions.type.main": "Main",
  "sessions.type.feishu-dm": "Feishu DM",
  "sessions.type.feishu-group": "Feishu Group",
  "sessions.type.discord-dm": "Discord DM",
  "sessions.type.discord-channel": "Discord Channel",
  "sessions.type.telegram-dm": "Telegram DM",
  "sessions.type.telegram-group": "Telegram Group",
  "sessions.type.whatsapp-dm": "WhatsApp DM",
  "sessions.type.whatsapp-group": "WhatsApp Group",
  "sessions.type.cron": "Cron Job",
  "sessions.type.unknown": "Unknown",
  "sessions.test": "Test",
  "sessions.testing": "Testing...",
  "sessions.testOk": "✅ OK",
  "sessions.testFail": "❌ Failed",
  "sessions.testReply": "Reply",
  "sessions.testTime": "Time",
  "sessions.context": "Context",
  "sessions.selectAgent": "Select an agent to view its sessions",
  "sessions.testAll": "🧪 Test All",
  "sessions.testingAll": "⏳ Testing...",
  "sessions.testHint": "Tests verify agent responsiveness only. Messages will not appear in Feishu or Discord chats.",
  "sessions.testAllResult": "Test complete",
  "sessions.testAllOk": "passed",
  "sessions.testAllFail": "failed",

  // skills page
  "skills.title": "🧩 Skill Management",
  "skills.count": "skills",
  "skills.builtin": "Built-in",
  "skills.extension": "Extension",
  "skills.custom": "Custom",
  "skills.all": "All",
  "skills.search": "Search skills...",
  "skills.showing": "Showing",
  "skills.unit": "",
  "skills.noDesc": "No description",
  "skills.source.builtin": "Built-in",
  "skills.source.custom": "Custom",
  "skills.viewSource": "View SKILL.md",
  "skills.contentTitle": "SKILL.md",
  "skills.loadingContent": "Loading skill content...",
  "skills.contentLoadFailed": "Failed to load skill content",

  // gateway status
  "gateway.healthy": "Gateway is running",
  "gateway.unhealthy": "Gateway is down",
  "gateway.fetchError": "Cannot check Gateway status",

  // pixel office
  "pixelOffice.title": "OpenClaw Agents Office",
  "pixelOffice.editMode": "Edit Layout",
  "pixelOffice.exitEdit": "Exit Edit",
  "pixelOffice.save": "Save",
  "pixelOffice.reset": "Reset",
  "pixelOffice.undo": "Undo",
  "pixelOffice.redo": "Redo",
  "pixelOffice.sound": "Sound",
  "pixelOffice.resetView": "Reset View",
  "pixelOffice.state.working": "Working",
  "pixelOffice.state.idle": "Idle",
  "pixelOffice.state.offline": "Offline",
  "pixelOffice.state.waiting": "Waiting",
  "pixelOffice.tempWorker": "Temp",
  "pixelOffice.tempWorker.source": "Temp Worker Source",
  "pixelOffice.tempWorker.createdBy": "created subagent",
  "pixelOffice.broadcast.online": "is online",
  "pixelOffice.broadcast.offline": "is offline",
  "pixelOffice.heatmap.title": "Agent Activity Heatmap",
  "pixelOffice.heatmap.messages": "messages",
  "pixelOffice.idleRank.title": "Slacking Leaderboard",
  "pixelOffice.idleRank.online": "Online",
  "pixelOffice.idleRank.active": "Active",
  "pixelOffice.idleRank.idle": "Slacking",
  "pixelOffice.serverStatus.checking": "Checking server status...",
  "pixelOffice.serverStatus.healthy": "Service healthy",
  "pixelOffice.serverStatus.degraded": "Service degraded",
  "pixelOffice.serverStatus.down": "Service down",
  "pixelOffice.serverStatus.unknown": "Service status unknown",
  "pixelOffice.serverStatus.fetchFailed": "Failed to check service status",
  "pixelOffice.gatewaySre.name": "On-Call SRE",
  "pixelOffice.gatewaySre.statusLabel": "Gateway status",
  "pixelOffice.gatewaySre.responseMs": "Check latency",
  "pixelOffice.gatewaySre.status.unknown": "Monitoring",
  "pixelOffice.gatewaySre.status.healthy": "Healthy",
  "pixelOffice.gatewaySre.status.degraded": "Degraded",
  "pixelOffice.gatewaySre.status.down": "Down",
  "pixelOffice.gatewaySre.tip.unknown": "Waiting for gateway health data",
  "pixelOffice.gatewaySre.tip.healthy": "Gateway healthy",
  "pixelOffice.gatewaySre.tip.degraded": "Gateway degraded: latency high",
  "pixelOffice.gatewaySre.tip.down": "Gateway down",
};

const translations: Record<Locale, Record<string, string>> = {
  "zh-TW": englishTranslations,
  zh: englishTranslations,
  en: englishTranslations,
};

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale;
    if (saved && (saved === "zh-TW" || saved === "zh" || saved === "en")) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") {
      localStorage.setItem("locale", l);
    }
  }, []);

  const t = useCallback(
    (key: string) => translations[locale]?.[key] ?? englishTranslations[key] ?? key,
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)] text-xs font-medium hover:border-[var(--accent)] transition cursor-pointer text-[var(--text)]"
    >
      <option value="zh-TW">Traditional</option>
      <option value="zh">Simplified</option>
      <option value="en">English</option>
    </select>
  );
}
