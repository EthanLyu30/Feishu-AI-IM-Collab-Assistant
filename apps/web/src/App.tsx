import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquareText,
  Monitor,
  Presentation,
  Send,
  Settings2,
  Smartphone,
  Sparkles
} from "lucide-react";
import type { AgentEvent, Artifact, RuntimeConfig, Task } from "@agent-pilot/shared";
import { sampleDiscussion, sampleIntent } from "@agent-pilot/shared";
import {
  createTask,
  fetchRuntimeConfig,
  fetchTasks,
  getEndpointConfig,
  getRealtimeWsUrl,
  resetEndpointConfig,
  saveEndpointConfig,
  sendCommand,
  type EndpointConfig
} from "./api";

type SocketMessage =
  | { type: "snapshot"; tasks: Task[]; events: AgentEvent[] }
  | { type: "event"; tasks: Task[]; event: AgentEvent };

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [endpointConfig, setEndpointConfig] = useState<EndpointConfig>(() => getEndpointConfig());
  const [endpointDraft, setEndpointDraft] = useState(() => getEndpointConfig());
  const [intent, setIntent] = useState(sampleIntent);
  const [command, setCommand] = useState("把权限管理补充得更详细一点，并加上学生和老师的不同操作边界。");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [error, setError] = useState<string | null>(null);
  const apiWsUrl = useMemo(() => getRealtimeWsUrl(), [endpointConfig]);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? tasks[0],
    [activeTaskId, tasks]
  );

  const taskEvents = useMemo(
    () => events.filter((event) => event.taskId === activeTask?.id),
    [activeTask?.id, events]
  );

  const triggerEntries = useMemo(() => buildTriggerEntries(activeTask, runtimeConfig), [activeTask, runtimeConfig]);
  const deliveryItems = useMemo(() => buildDeliveryItems(activeTask), [activeTask]);
  const confirmationItems = useMemo(() => buildConfirmationItems(activeTask, deliveryItems), [activeTask, deliveryItems]);
  const endpointLabel = endpointConfig.source === "local" ? "local" : endpointConfig.source;

  useEffect(() => {
    const refreshEndpointConfig = () => {
      const nextConfig = getEndpointConfig();
      setEndpointConfig(nextConfig);
      setEndpointDraft(nextConfig);
    };

    window.addEventListener("agent-pilot:endpoints-changed", refreshEndpointConfig);
    return () => window.removeEventListener("agent-pilot:endpoints-changed", refreshEndpointConfig);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function refreshRuntimeState() {
      setError(null);
      try {
        const [nextConfig, items] = await Promise.all([fetchRuntimeConfig(), fetchTasks()]);
        if (ignore) return;
        setRuntimeConfig(nextConfig);
        setTasks(items);
        if (items[0]) setActiveTaskId((current) => current ?? items[0].id);
      } catch (err) {
        if (ignore) return;
        setConnection("offline");
        setError(
          err instanceof Error
            ? `无法连接 Agent API：${err.message}`
            : "无法连接 Agent API"
        );
      }
    }

    void refreshRuntimeState();
    return () => {
      ignore = true;
    };
  }, [endpointConfig]);

  useEffect(() => {
    setConnection("connecting");
    const socket = new WebSocket(apiWsUrl);
    socket.onopen = () => setConnection("live");
    socket.onclose = () => setConnection("offline");
    socket.onerror = () => setConnection("offline");
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data) as SocketMessage;
      if (data.type === "snapshot") {
        setTasks(data.tasks);
        setEvents(data.events);
        if (data.tasks[0]) setActiveTaskId((current) => current ?? data.tasks[0].id);
      }
      if (data.type === "event") {
        setTasks(data.tasks);
        setEvents((current) => [...current, data.event]);
        setActiveTaskId(data.event.taskId);
      }
    };
    return () => socket.close();
  }, [apiWsUrl]);

  async function handleCreateTask() {
    setError(null);
    try {
      const task = await createTask({ intent, source: "desktop" });
      setActiveTaskId(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务创建失败");
    }
  }

  async function handleSendCommand() {
    if (!activeTask) return;
    setError(null);
    try {
      await sendCommand(activeTask.id, { command });
    } catch (err) {
      setError(err instanceof Error ? err.message : "指令发送失败");
    }
  }

  function handleEndpointSave() {
    setError(null);
    saveEndpointConfig(endpointDraft);
  }

  function handleEndpointReset() {
    setError(null);
    resetEndpointConfig();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">
            <Sparkles size={20} />
          </div>
          <div>
            <p className="eyebrow">Agent-Pilot</p>
            <h1>IM 办公协同智能助手</h1>
          </div>
        </div>
        <div className="statusRail">
          <StatusPill label="实时同步" value={connection === "live" ? "Live" : connection} tone={connection === "live" ? "good" : "warn"} />
          <StatusPill label="LLM" value={runtimeConfig?.llmMode ?? "..."} tone={runtimeConfig?.llmMode === "doubao" ? "good" : "neutral"} />
          <StatusPill label="Office" value={runtimeConfig?.officeAdapter ?? "..."} tone="neutral" />
          <StatusPill label="API" value={endpointLabel} tone={endpointConfig.source === "local" ? "neutral" : "good"} />
          <StatusPill
            label="测试群"
            value={runtimeConfig?.hasLarkDefaultChatId ? "已配置" : "未配置"}
            tone={runtimeConfig?.hasLarkDefaultChatId ? "good" : "warn"}
          />
        </div>
      </header>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="workspace">
        <aside className="mobilePane">
          <PaneTitle icon={<Smartphone size={18} />} title="移动端 IM 入口" subtitle="自然语言触发任务" />
          <div className="phoneFrame">
            <div className="chatHeader">校园活动报名系统讨论群</div>
            <div className="chatList">
              {sampleDiscussion.map((message) => (
                <div className={`bubble ${message.sender === "user" ? "mine" : ""}`} key={message.id}>
                  {message.content}
                </div>
              ))}
              <div className="bubble agentBubble">可以直接告诉我你想沉淀成什么成果。</div>
            </div>
            <div className="composer">
              <textarea value={intent} onChange={(event) => setIntent(event.target.value)} />
              <button className="iconButton primary" onClick={handleCreateTask} title="发送指令">
                <Send size={18} />
              </button>
            </div>
          </div>
        </aside>

        <section className="desktopPane">
          <PaneTitle icon={<Monitor size={18} />} title="桌面端 Agent 仪表盘" subtitle="规划、执行、产物与交付" />
          <div className="overviewStrip">
            <div className="panel miniPanel triggerPanel">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">Entry</p>
                  <h2>触发入口状态</h2>
                </div>
                <MessageSquareText size={20} />
              </div>
              <div className="statusStack">
                {triggerEntries.map((entry) => (
                  <StatusRow key={entry.label} {...entry} />
                ))}
              </div>
            </div>

            <div className="panel miniPanel deliveryPanel">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">Delivery</p>
                  <h2>Docs / Slides 交付</h2>
                </div>
                <ClipboardCheck size={20} />
              </div>
              <div className="deliveryGrid">
                {deliveryItems.map((item) => (
                  <DeliveryTile key={item.label} {...item} />
                ))}
              </div>
            </div>

            <div className="panel miniPanel confirmPanel">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">Next</p>
                  <h2>下一步确认节点</h2>
                </div>
                <Clock3 size={20} />
              </div>
              <div className="confirmList">
                {confirmationItems.map((item) => (
                  <div className={`confirmItem ${item.tone}`} key={item.title}>
                    <span>{item.state}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="dashboardGrid">
            <div className="panel taskPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Current Task</p>
                  <h2>{activeTask?.title ?? "等待 IM 指令"}</h2>
                </div>
                {activeTask ? (
                  <div className="taskBadges">
                    <SourceBadge source={activeTask.source} />
                    <TaskBadge status={activeTask.status} />
                  </div>
                ) : null}
              </div>
              {activeTask ? (
                <>
                  <p className="intentText">{activeTask.userIntent}</p>
                  <div className="stepList">
                    {activeTask.plan?.steps.map((step) => (
                      <div className="stepItem" key={step.id}>
                        <div className={`stepIcon ${step.status}`}>
                          {step.status === "completed" ? <CheckCircle2 size={16} /> : <Loader2 size={16} />}
                        </div>
                        <div>
                          <strong>{step.title}</strong>
                          <p>{step.outputSummary ?? step.expectedOutput}</p>
                        </div>
                      </div>
                    )) ?? <p className="empty">Agent 计划生成后会显示在这里。</p>}
                  </div>
                </>
              ) : (
                <p className="empty">在左侧 IM 输入框发送示例指令，开始第一条 Agent 工作流。</p>
              )}
            </div>

            <div className="panel commandPanel">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">Follow-up</p>
                  <h2>自然语言迭代</h2>
                </div>
                <Bot size={20} />
              </div>
              <textarea value={command} onChange={(event) => setCommand(event.target.value)} />
              <button className="textButton" onClick={handleSendCommand} disabled={!activeTask}>
                <Send size={16} />
                发送追加修改
              </button>
              <div className="endpointPanel">
                <div className="endpointHeader">
                  <Settings2 size={16} />
                  <strong>连接设置</strong>
                  <span>{endpointConfig.source}</span>
                </div>
                <label>
                  API 地址
                  <input
                    value={endpointDraft.apiBaseUrl}
                    onChange={(event) =>
                      setEndpointDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))
                    }
                    placeholder="https://your-api.trycloudflare.com"
                  />
                </label>
                <label>
                  WS 地址
                  <input
                    value={endpointDraft.wsUrl}
                    onChange={(event) =>
                      setEndpointDraft((current) => ({ ...current, wsUrl: event.target.value }))
                    }
                    placeholder="wss://your-api.trycloudflare.com/ws"
                  />
                </label>
                <div className="endpointActions">
                  <button className="secondaryButton" type="button" onClick={handleEndpointReset}>
                    重置
                  </button>
                  <button className="secondaryButton primary" type="button" onClick={handleEndpointSave}>
                    应用
                  </button>
                </div>
              </div>
            </div>

            <div className="panel artifactsPanel">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">Artifacts</p>
                  <h2>生成产物</h2>
                </div>
              </div>
              <div className="artifactList">
                {activeTask?.artifacts.map((artifact) => (
                  <ArtifactCard artifact={artifact} key={artifact.id} />
                )) ?? <p className="empty">暂无产物。</p>}
              </div>
            </div>

            <div className="panel eventPanel">
              <div className="panelHeader compact">
                <div>
                  <p className="eyebrow">Realtime</p>
                  <h2>同步事件</h2>
                </div>
              </div>
              <div className="eventList">
                {taskEvents.slice(-8).reverse().map((event) => (
                  <div className="eventItem" key={event.id}>
                    <div>
                      <span>{event.type}</span>
                      {typeof event.payload.message === "string" ? <p>{event.payload.message}</p> : null}
                    </div>
                    <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                  </div>
                ))}
                {!taskEvents.length ? <p className="empty">任务事件会实时推送到这里。</p> : null}
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function PaneTitle(props: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="paneTitle">
      <div className="paneIcon">{props.icon}</div>
      <div>
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
      </div>
    </div>
  );
}

function StatusRow(props: { label: string; value: string; detail: string; tone: "good" | "warn" | "neutral" }) {
  return (
    <div className={`statusRow ${props.tone}`}>
      <div>
        <strong>{props.label}</strong>
        <p>{props.detail}</p>
      </div>
      <span>{props.value}</span>
    </div>
  );
}

function StatusPill(props: { label: string; value: string; tone: "good" | "warn" | "neutral" }) {
  return (
    <div className={`statusPill ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function TaskBadge(props: { status: Task["status"] }) {
  return <span className={`taskBadge ${props.status}`}>{props.status}</span>;
}

function SourceBadge(props: { source: Task["source"] }) {
  const sourceLabel: Record<Task["source"], string> = {
    im: "飞书 IM",
    mobile: "移动端",
    desktop: "Web 触发",
    api: "API"
  };
  return <span className="sourceBadge">{sourceLabel[props.source]}</span>;
}

function DeliveryTile(props: { label: string; value: string; meta: string; tone: "good" | "warn" | "neutral"; icon: ReactNode }) {
  return (
    <div className={`deliveryTile ${props.tone}`}>
      <div className="deliveryIcon">{props.icon}</div>
      <div>
        <strong>{props.label}</strong>
        <span>{props.value}</span>
        <p>{props.meta}</p>
      </div>
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const icon = artifact.type === "slides" ? <Presentation size={18} /> : <FileText size={18} />;
  const linkState = getArtifactLinkState(artifact);
  return (
    <article className="artifactCard">
      <div className="artifactIcon">{icon}</div>
      <div>
        <strong>{artifact.title}</strong>
        <p>{artifact.type} · v{artifact.version} · {linkState.label}</p>
        {artifact.url ? (
          <a className="artifactLink" href={artifact.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            打开产物
          </a>
        ) : null}
        <pre>{artifact.content.slice(0, 420)}</pre>
      </div>
    </article>
  );
}

function buildTriggerEntries(activeTask: Task | undefined, runtimeConfig: RuntimeConfig | null) {
  const isWebTriggered = activeTask?.source === "desktop" || activeTask?.source === "api";
  const larkConnected = runtimeConfig?.officeAdapter === "lark-cli" && runtimeConfig.hasLarkDefaultChatId;
  const larkPendingConfig = runtimeConfig?.officeAdapter === "lark-cli" && !runtimeConfig.hasLarkDefaultChatId;

  return [
    {
      label: "Web 触发",
      value: isWebTriggered ? "当前入口" : "可用",
      detail: activeTask ? `最近任务：${sourceText(activeTask.source)}` : "可在当前页面直接创建任务",
      tone: isWebTriggered ? "good" : "neutral"
    },
    {
      label: "飞书 IM 触发",
      value: larkConnected ? "已接入" : larkPendingConfig ? "待配置群" : "待接入",
      detail: larkConnected ? "可向默认群发送交付摘要" : "当前仍通过 Web 页面模拟/触发流程",
      tone: larkConnected ? "good" : "warn"
    }
  ] as const;
}

function buildDeliveryItems(activeTask: Task | undefined) {
  const doc = activeTask?.artifacts.find((artifact) => artifact.type === "doc");
  const slides = activeTask?.artifacts.find((artifact) => artifact.type === "slides");
  const summary = activeTask?.artifacts.find((artifact) => artifact.type === "summary" || artifact.type === "export");

  return [
    buildDeliveryItem("Docs", doc, <FileText size={16} />),
    buildDeliveryItem("Slides", slides, <Presentation size={16} />),
    buildDeliveryItem("交付摘要", summary, <CheckCircle2 size={16} />)
  ];
}

function buildDeliveryItem(label: string, artifact: Artifact | undefined, icon: ReactNode) {
  if (!artifact) {
    return { label, value: "未生成", meta: "等待 Agent 步骤完成", tone: "neutral" as const, icon };
  }

  const linkState = getArtifactLinkState(artifact);
  return {
    label,
    value: linkState.value,
    meta: `v${artifact.version} · ${formatTime(artifact.updatedAt)}`,
    tone: linkState.tone,
    icon
  };
}

function buildConfirmationItems(activeTask: Task | undefined, deliveryItems: ReturnType<typeof buildDeliveryItems>) {
  if (!activeTask) {
    return [
      {
        title: "等待首个任务",
        description: "从 Web 输入任务目标后，这里会显示需要人工确认的节点。",
        state: "待触发",
        tone: "neutral"
      }
    ] as const;
  }

  if (activeTask.status === "failed") {
    return [
      {
        title: "确认失败原因",
        description: activeTask.error ?? "查看实时事件后重新触发或调整输入。",
        state: "需处理",
        tone: "warn"
      }
    ] as const;
  }

  const required = activeTask.plan?.requiredConfirmations ?? [];
  if (required.length) {
    return required.slice(0, 3).map((item, index) => ({
      title: item,
      description: index === 0 ? "优先确认后再继续发送或迭代交付。" : "可在后续迭代中补充确认。",
      state: activeTask.status === "completed" ? "待确认" : "排队中",
      tone: activeTask.status === "completed" ? "warn" : "neutral"
    }));
  }

  const hasMissingDelivery = deliveryItems.some((item) => item.value === "未生成");
  return [
    {
      title: hasMissingDelivery ? "等待 Docs / Slides 生成完成" : "确认内容并决定是否发送飞书群",
      description: hasMissingDelivery ? "Agent 完成交付步骤后会进入人工确认。" : "检查文档、PPT 和摘要链接，再进行下一轮修改或群内交付。",
      state: hasMissingDelivery ? "进行中" : "待确认",
      tone: hasMissingDelivery ? "neutral" : "warn"
    }
  ] as const;
}

function getArtifactLinkState(artifact: Artifact) {
  if (!artifact.url) return { label: "无链接", value: "内容已生成", tone: "warn" as const };
  if (artifact.url.startsWith("mock://")) return { label: "模拟链接", value: "模拟交付", tone: "warn" as const };
  return { label: "真实链接", value: "可打开", tone: "good" as const };
}

function sourceText(source: Task["source"]) {
  const sourceLabel: Record<Task["source"], string> = {
    im: "飞书 IM",
    mobile: "移动端",
    desktop: "Web 触发",
    api: "API"
  };
  return sourceLabel[source];
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
