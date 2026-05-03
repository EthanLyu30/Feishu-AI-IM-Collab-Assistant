import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  FileText,
  Gauge,
  LayoutDashboard,
  Loader2,
  Menu,
  MessageSquareText,
  Monitor,
  Presentation,
  Radio,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  XCircle
} from "lucide-react";
import type { AgentEvent, AgentStep, Artifact, ReadinessStatus, RuntimeConfig, Task } from "@agent-pilot/shared";
import { sampleDiscussion, sampleIntent } from "@agent-pilot/shared";
import {
  createTask,
  fetchReadiness,
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

const workflowStages = [
  { tool: "im.read", label: "IM", icon: <MessageSquareText size={16} /> },
  { tool: "planner", label: "Plan", icon: <Bot size={16} /> },
  { tool: "doc.create", label: "Doc", icon: <FileText size={16} /> },
  { tool: "slides.create", label: "Slides", icon: <Presentation size={16} /> },
  { tool: "summary.deliver", label: "Deliver", icon: <CheckCircle2 size={16} /> }
] as const;

const sceneMeta = [
  { id: "A", title: "IM 入口", detail: "群聊自然语言", icon: <MessageSquareText size={16} /> },
  { id: "B", title: "任务规划", detail: "Planner 拆解", icon: <Bot size={16} /> },
  { id: "C", title: "Docs", detail: "需求文档", icon: <FileText size={16} /> },
  { id: "D", title: "Slides", detail: "汇报材料", icon: <Presentation size={16} /> },
  { id: "E", title: "多端同步", detail: "WebSocket 状态", icon: <Monitor size={16} /> },
  { id: "F", title: "总结交付", detail: "群回发归档", icon: <CheckCircle2 size={16} /> }
] as const;

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);
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
  const deliveryItems = useMemo(() => buildDeliveryItems(activeTask), [activeTask]);
  const runMetrics = useMemo(
    () => buildRunMetrics(activeTask, readiness, taskEvents, deliveryItems, connection),
    [activeTask, connection, deliveryItems, readiness, taskEvents]
  );
  const nextActions = useMemo(
    () => buildNextActions(activeTask, readiness, deliveryItems),
    [activeTask, deliveryItems, readiness]
  );
  const endpointLabel = endpointConfig.source === "local" ? "same-origin" : endpointConfig.source;

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
        const [nextConfig, nextReadiness, items] = await Promise.all([
          fetchRuntimeConfig(),
          fetchReadiness(),
          fetchTasks()
        ]);
        if (ignore) return;
        setRuntimeConfig(nextConfig);
        setReadiness(nextReadiness);
        setTasks(items);
        if (items[0]) setActiveTaskId((current) => current ?? items[0].id);
      } catch (err) {
        if (ignore) return;
        setConnection("offline");
        setError(err instanceof Error ? `无法连接 Agent API：${err.message}` : "无法连接 Agent API");
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
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setActiveTaskId(task.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务创建失败");
    }
  }

  async function handleSendCommand() {
    if (!activeTask) return;
    setError(null);
    try {
      const task = await sendCommand(activeTask.id, { command });
      setTasks((current) => current.map((item) => (item.id === task.id ? task : item)));
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
    <main className="appShell">
      <aside className="sideNav" aria-label="Agent-Pilot navigation">
        <div className="navBrand">
          <div className="brandGlyph">
            <Sparkles size={18} />
          </div>
          <div>
            <strong>Agent-Pilot</strong>
            <span>Feishu IM</span>
          </div>
        </div>
        <nav className="navItems">
          <NavItem active icon={<LayoutDashboard size={18} />} label="运行台" />
          <NavItem icon={<Activity size={18} />} label="流程" />
          <NavItem icon={<FileText size={18} />} label="产物" />
          <NavItem icon={<ShieldCheck size={18} />} label="检查" />
        </nav>
        <div className="navFoot">
          <StatusDot state={connection} />
          <span>{connection === "live" ? "实时连接" : connection === "connecting" ? "连接中" : "离线"}</span>
        </div>
      </aside>

      <section className="workbench">
        <header className="headerBar">
          <div>
            <div className="pageKicker">
              <span>Agent-Pilot Console</span>
              <span>Feishu Office Loop</span>
            </div>
            <h1>飞书协同 Agent 运行台</h1>
            <p>IM 触发，Agent 编排，Docs / Slides / 群回发统一观测。</p>
          </div>
          <div className="headerActions">
            <MetricPill label="LLM" value={runtimeConfig?.llmMode ?? "..."} tone={runtimeConfig?.llmMode === "doubao" ? "good" : "neutral"} />
            <MetricPill label="Office" value={runtimeConfig?.officeAdapter ?? "..."} tone={runtimeConfig?.officeAdapter === "lark-cli" ? "good" : "neutral"} />
            <MetricPill label="API" value={endpointLabel} tone="good" />
          </div>
        </header>

        {error ? <div className="errorBanner">{error}</div> : null}

        <section className="commandDeck">
          <div className="deckMain">
            <div className="deckTopline">
              <div className="deckTitle">
                <div className="sectionIcon">
                  <MessageSquareText size={18} />
                </div>
                <div>
                  <h2>自然语言任务入口</h2>
                  <p>{runtimeConfig?.hasLarkDefaultChatId ? "已连接飞书测试群，也可在此发起同等流程。" : "当前页面可发起同等流程。"}</p>
                </div>
              </div>
              <div className="missionState">
                <span>{connection === "live" ? "Live" : connection === "connecting" ? "Syncing" : "Offline"}</span>
                <strong>{activeTask?.status ?? "standby"}</strong>
              </div>
            </div>
            <div className="intentComposer">
              <textarea value={intent} onChange={(event) => setIntent(event.target.value)} />
              <button className="primaryButton" type="button" onClick={handleCreateTask}>
                <Send size={16} />
                启动 Agent
              </button>
            </div>
            <div className="runMetricGrid">
              {runMetrics.map((metric) => (
                <RunMetricCard key={metric.label} {...metric} />
              ))}
            </div>
          </div>
          <div className="deckAside">
            <div className="cloudBadge">
              <Radio size={16} />
              <span>云端常驻</span>
              <strong>{readiness?.ok ? "Ready" : "Check"}</strong>
            </div>
            <p>当前服务器入口可同时作为飞书桌面端和移动端网页应用主页。</p>
            <div className="miniCheckList">
              <MiniCheck label="Doubao" ok={runtimeConfig?.llmMode === "doubao"} />
              <MiniCheck label="lark-cli" ok={runtimeConfig?.officeAdapter === "lark-cli"} />
              <MiniCheck label="WebSocket" ok={connection === "live"} />
            </div>
          </div>
        </section>

        <SceneCoverage
          activeTask={activeTask}
          connection={connection}
          readiness={readiness}
          runtimeConfig={runtimeConfig}
        />

        <section className="contentGrid">
          <section className="mainColumn">
            <Panel
              title={activeTask?.title ?? "等待任务"}
              label="Current pipeline"
              icon={<Gauge size={18} />}
              action={activeTask ? <TaskBadge status={activeTask.status} /> : null}
            >
              <p className="intentText">{activeTask?.userIntent ?? "从飞书群聊或上方输入框启动一次 IM 到 Docs / Slides 的协同任务。"}</p>
              <PipelineOverview task={activeTask} />
              <WorkflowRail task={activeTask} />
              <StepTimeline task={activeTask} />
            </Panel>

            <div className="lowerGrid">
              <Panel title="生成产物" label="Artifacts" icon={<Presentation size={18} />}>
                <DeliveryStrip items={deliveryItems} />
                <div className="artifactList">
                  {activeTask?.artifacts.length ? (
                    activeTask.artifacts.map((artifact) => <ArtifactRow artifact={artifact} key={artifact.id} />)
                  ) : (
                    <EmptyState text="Docs、Slides 和交付摘要生成后会出现在这里。" />
                  )}
                </div>
              </Panel>
              <Panel title="同步事件" label="Realtime log" icon={<Activity size={18} />}>
                <EventList events={taskEvents} />
              </Panel>
            </div>
          </section>

          <aside className="rightColumn">
            <Panel title="飞书入口" label="IM / Mobile" icon={<Smartphone size={18} />}>
              <div className="chatPreview">
                <div className="chatPreviewTop">
                  <span>校园活动报名系统讨论群</span>
                  <Menu size={16} />
                </div>
                <div className="chatMessages">
                  {sampleDiscussion.slice(0, 4).map((message) => (
                    <div className={`chatBubble ${message.sender === "user" ? "mine" : ""}`} key={message.id}>
                      {message.content}
                    </div>
                  ))}
                  <div className="chatBubble agent">/agent 请整理讨论，生成需求文档和汇报 PPT。</div>
                </div>
              </div>
            </Panel>

            <Panel title="自然语言迭代" label="Follow-up" icon={<Bot size={18} />}>
              <textarea className="followupInput" value={command} onChange={(event) => setCommand(event.target.value)} />
              <button className="primaryButton full" type="button" onClick={handleSendCommand} disabled={!activeTask}>
                <Send size={16} />
                发送追加修改
              </button>
            </Panel>

            <Panel title="下一步" label="Operator queue" icon={<Clock3 size={18} />}>
              <div className="nextActionList">
                {nextActions.map((item) => (
                  <NextAction key={item.title} {...item} />
                ))}
              </div>
            </Panel>

            <Panel title="运行检查" label="Readiness" icon={<ShieldCheck size={18} />}>
              <ReadinessPanel readiness={readiness} />
            </Panel>

            <Panel title="连接设置" label="Endpoint" icon={<Settings2 size={18} />}>
              <EndpointSettings
                endpointConfig={endpointConfig}
                endpointDraft={endpointDraft}
                onDraftChange={setEndpointDraft}
                onReset={handleEndpointReset}
                onSave={handleEndpointSave}
              />
            </Panel>
          </aside>
        </section>
      </section>
    </main>
  );
}

function RunMetricCard(props: { label: string; value: string; detail: string; tone: "good" | "warn" | "neutral" }) {
  return (
    <div className={`runMetricCard ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <p>{props.detail}</p>
    </div>
  );
}

function MiniCheck(props: { label: string; ok: boolean }) {
  return (
    <div className={`miniCheck ${props.ok ? "good" : "warn"}`}>
      <span>{props.ok ? "OK" : "待补"}</span>
      <strong>{props.label}</strong>
    </div>
  );
}

function NavItem(props: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <button className={`navItem ${props.active ? "active" : ""}`} type="button">
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function Panel(props: { title: string; label: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="panelTitle">
          <div className="sectionIcon">{props.icon}</div>
          <div>
            <span>{props.label}</span>
            <h2>{props.title}</h2>
          </div>
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function SceneCoverage(props: {
  activeTask: Task | undefined;
  connection: "connecting" | "live" | "offline";
  readiness: ReadinessStatus | null;
  runtimeConfig: RuntimeConfig | null;
}) {
  const items = buildSceneCoverage(props.activeTask, props.runtimeConfig, props.readiness, props.connection);

  return (
    <section className="sceneCoverage" aria-label="Agent-Pilot scenario coverage">
      <div className="sceneCoverageLead">
        <span>Scenario map</span>
        <strong>A-F 场景覆盖</strong>
      </div>
      <div className="sceneCoverageTrack">
        {items.map((item) => (
          <div className={`sceneNode ${item.tone}`} key={item.id}>
            <div className="sceneMark">
              <span>{item.id}</span>
              {item.icon}
            </div>
            <div>
              <strong>{item.title}</strong>
              <p>{item.state}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PipelineOverview({ task }: { task: Task | undefined }) {
  const total = task?.plan?.steps.length ?? 0;
  const completed = task?.plan?.steps.filter((step) => step.status === "completed").length ?? 0;
  const runningStep = task?.plan?.steps.find((step) => step.status === "running");
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="pipelineOverview">
      <div className="progressRing" style={{ "--progress": `${percent}%` } as CSSProperties}>
        <span>{percent}</span>
      </div>
      <div>
        <span>执行进度</span>
        <strong>{runningStep?.title ?? (task ? "等待下一步状态" : "等待 IM 触发")}</strong>
        <p>{total > 0 ? `${completed}/${total} 个步骤已完成` : "规划生成后会展示步骤进度、工具调用和产物状态。"}</p>
      </div>
    </div>
  );
}

function WorkflowRail({ task }: { task: Task | undefined }) {
  return (
    <div className="workflowRail">
      {workflowStages.map((stage, index) => {
        const status = getStageStatus(task, stage.tool);
        return (
          <div className={`workflowStage ${status}`} key={stage.label}>
            <div className="stageIcon">{stage.icon}</div>
            <span>{stage.label}</span>
            {index < workflowStages.length - 1 ? <ChevronRight size={16} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function DeliveryStrip(props: { items: ReturnType<typeof buildDeliveryItems> }) {
  return (
    <div className="deliveryStrip">
      {props.items.map((item) => (
        <div className={`deliveryItem ${item.tone}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function StepTimeline({ task }: { task: Task | undefined }) {
  if (!task?.plan?.steps.length) {
    return <EmptyState text="Agent 完成规划后，执行步骤会以流水线形式展开。" />;
  }

  return (
    <div className="stepTimeline">
      {task.plan.steps.map((step) => (
        <div className="stepRow" key={step.id}>
          <StepStateIcon status={step.status} />
          <div>
            <strong>{step.title}</strong>
            <p>{step.outputSummary ?? step.expectedOutput}</p>
          </div>
          <span>{step.tool}</span>
        </div>
      ))}
    </div>
  );
}

function StepStateIcon({ status }: { status: AgentStep["status"] }) {
  if (status === "completed") return <div className="stateIcon completed"><Check size={14} /></div>;
  if (status === "failed") return <div className="stateIcon failed"><XCircle size={14} /></div>;
  if (status === "running") return <div className="stateIcon running"><Loader2 size={14} /></div>;
  return <div className="stateIcon pending"><Circle size={14} /></div>;
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  const state = getArtifactLinkState(artifact);
  const icon = artifact.type === "slides" ? <Presentation size={16} /> : <FileText size={16} />;
  return (
    <article className="artifactRow">
      <div className="artifactType">{icon}</div>
      <div>
        <strong>{artifact.title}</strong>
        <p>{artifact.type} · v{artifact.version} · {state.label}</p>
      </div>
      {artifact.url ? (
        <a href={artifact.url} target="_blank" rel="noreferrer" aria-label={`打开 ${artifact.title}`}>
          <ExternalLink size={16} />
        </a>
      ) : null}
    </article>
  );
}

function EventList({ events }: { events: AgentEvent[] }) {
  const recentEvents = events.slice(-9).reverse();
  if (!recentEvents.length) return <EmptyState text="任务事件会实时推送到这里。" />;

  return (
    <div className="eventList">
      {recentEvents.map((event) => (
        <div className="eventRow" key={event.id}>
          <div>
            <strong>{event.type}</strong>
            {typeof event.payload.message === "string" ? <p>{event.payload.message}</p> : null}
          </div>
          <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
        </div>
      ))}
    </div>
  );
}

function NextAction(props: { title: string; description: string; tone: "good" | "warn" | "neutral"; state: string }) {
  return (
    <div className={`nextAction ${props.tone}`}>
      <span>{props.state}</span>
      <div>
        <strong>{props.title}</strong>
        <p>{props.description}</p>
      </div>
    </div>
  );
}

function ReadinessPanel({ readiness }: { readiness: ReadinessStatus | null }) {
  const checks = readiness?.checks ?? [];
  if (!checks.length) return <EmptyState text="连接 Agent API 后会显示部署检查项。" />;

  return (
    <div className="readinessList">
      {checks.slice(0, 8).map((check) => (
        <div className={`readinessRow ${check.ok ? "good" : check.required ? "bad" : "warn"}`} key={check.id} title={check.detail}>
          <span>{check.ok ? "OK" : check.required ? "P0" : "P1"}</span>
          <div>
            <strong>{check.label}</strong>
            <p>{check.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EndpointSettings(props: {
  endpointConfig: EndpointConfig;
  endpointDraft: EndpointConfig;
  onDraftChange: (next: EndpointConfig) => void;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div className="endpointSettings">
      <div className="endpointMode">
        <span>当前来源</span>
        <strong>{props.endpointConfig.source}</strong>
      </div>
      <label>
        API 地址
        <input
          value={props.endpointDraft.apiBaseUrl}
          onChange={(event) => props.onDraftChange({ ...props.endpointDraft, apiBaseUrl: event.target.value })}
          placeholder="https://agent-pilot.example.com"
        />
      </label>
      <label>
        WS 地址
        <input
          value={props.endpointDraft.wsUrl}
          onChange={(event) => props.onDraftChange({ ...props.endpointDraft, wsUrl: event.target.value })}
          placeholder="wss://agent-pilot.example.com/ws"
        />
      </label>
      <div className="endpointActions">
        <button className="ghostButton" type="button" onClick={props.onReset}>
          <RotateCcw size={14} />
          重置
        </button>
        <button className="ghostButton primary" type="button" onClick={props.onSave}>
          应用
        </button>
      </div>
    </div>
  );
}

function MetricPill(props: { label: string; value: string; tone: "good" | "warn" | "neutral" }) {
  return (
    <div className={`metricPill ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function TaskBadge(props: { status: Task["status"] }) {
  return <span className={`taskBadge ${props.status}`}>{props.status}</span>;
}

function StatusDot({ state }: { state: "connecting" | "live" | "offline" }) {
  return <span className={`statusDot ${state}`} />;
}

function EmptyState({ text }: { text: string }) {
  return <p className="emptyState">{text}</p>;
}

function buildDeliveryItems(activeTask: Task | undefined) {
  const doc = activeTask?.artifacts.find((artifact) => artifact.type === "doc");
  const slides = activeTask?.artifacts.find((artifact) => artifact.type === "slides");
  const summary = activeTask?.artifacts.find((artifact) => artifact.type === "summary" || artifact.type === "export");

  return [
    { label: "Docs", artifact: doc },
    { label: "Slides", artifact: slides },
    { label: "交付摘要", artifact: summary }
  ].map((item) => {
    if (!item.artifact) return { ...item, value: "未生成", tone: "neutral" as const };
    const state = getArtifactLinkState(item.artifact);
    return { ...item, value: state.value, tone: state.tone };
  });
}

function buildRunMetrics(
  activeTask: Task | undefined,
  readiness: ReadinessStatus | null,
  events: AgentEvent[],
  deliveryItems: ReturnType<typeof buildDeliveryItems>,
  connection: "connecting" | "live" | "offline"
) {
  const totalSteps = activeTask?.plan?.steps.length ?? 0;
  const completedSteps = activeTask?.plan?.steps.filter((step) => step.status === "completed").length ?? 0;
  const requiredChecks = readiness?.checks.filter((check) => check.required) ?? [];
  const readyChecks = requiredChecks.filter((check) => check.ok).length;
  const totalChecks = requiredChecks.length;
  const openedArtifacts = deliveryItems.filter((item) => item.value === "可打开").length;

  return [
    {
      label: "Loop",
      value: totalSteps ? `${completedSteps}/${totalSteps}` : "standby",
      detail: activeTask?.status ?? "等待群聊或 Web 触发",
      tone: activeTask?.status === "failed" ? "warn" as const : "neutral" as const
    },
    {
      label: "Gates",
      value: totalChecks ? `${readyChecks}/${totalChecks}` : "--",
      detail: readiness?.ok ? "必需门禁已通过" : "等待 readiness",
      tone: readiness?.ok ? "good" as const : "warn" as const
    },
    {
      label: "Artifacts",
      value: `${openedArtifacts}/3`,
      detail: "Docs / Slides / 摘要",
      tone: openedArtifacts >= 2 ? "good" as const : "neutral" as const
    },
    {
      label: "Events",
      value: `${events.length}`,
      detail: connection === "live" ? "实时同步中" : "等待连接恢复",
      tone: connection === "live" ? "good" as const : "warn" as const
    }
  ];
}

function buildSceneCoverage(
  activeTask: Task | undefined,
  runtimeConfig: RuntimeConfig | null,
  readiness: ReadinessStatus | null,
  connection: "connecting" | "live" | "offline"
) {
  const hasArtifact = (type: Artifact["type"]) => activeTask?.artifacts.some((artifact) => artifact.type === type);
  const hasDoc = hasArtifact("doc");
  const hasSlides = hasArtifact("slides");
  const hasSummary = activeTask?.artifacts.some((artifact) => artifact.type === "summary" || artifact.type === "export");
  const requiredReady = readiness?.ok ?? false;
  const planned = Boolean(activeTask?.plan?.steps.length);

  return sceneMeta.map((scene) => {
    if (scene.id === "A") {
      return {
        ...scene,
        state: runtimeConfig?.hasLarkDefaultChatId ? "测试群已配置" : "等待群配置",
        tone: runtimeConfig?.hasLarkDefaultChatId ? "good" as const : "warn" as const
      };
    }
    if (scene.id === "B") {
      return {
        ...scene,
        state: planned ? "计划已生成" : runtimeConfig?.llmMode ? `${runtimeConfig.llmMode} 待触发` : "等待模型",
        tone: planned || runtimeConfig?.llmMode === "doubao" ? "good" as const : "neutral" as const
      };
    }
    if (scene.id === "C") {
      return { ...scene, state: hasDoc ? "文档已生成" : "待生成", tone: hasDoc ? "good" as const : "neutral" as const };
    }
    if (scene.id === "D") {
      return { ...scene, state: hasSlides ? "幻灯片已生成" : "待生成", tone: hasSlides ? "good" as const : "neutral" as const };
    }
    if (scene.id === "E") {
      return {
        ...scene,
        state: connection === "live" ? "实时同步" : connection === "connecting" ? "连接中" : "离线",
        tone: connection === "live" ? "good" as const : "warn" as const
      };
    }
    return {
      ...scene,
      state: hasSummary ? "摘要已交付" : requiredReady ? "待交付" : "先补运行项",
      tone: hasSummary ? "good" as const : requiredReady ? "neutral" as const : "warn" as const
    };
  });
}

function buildNextActions(
  activeTask: Task | undefined,
  readiness: ReadinessStatus | null,
  deliveryItems: ReturnType<typeof buildDeliveryItems>
) {
  const actions: Array<{ title: string; description: string; tone: "good" | "warn" | "neutral"; state: string }> = [];

  if (!activeTask) {
    actions.push({
      title: "等待 IM 或 Web 任务",
      description: "飞书群聊触发后会同步到这里。",
      tone: "neutral",
      state: "待触发"
    });
  } else if (activeTask.status === "failed") {
    actions.push({
      title: "定位失败步骤",
      description: activeTask.error ?? "查看事件日志并重新执行。",
      tone: "warn",
      state: "需处理"
    });
  } else if (activeTask.status === "completed") {
    actions.push({
      title: "打开 Docs / Slides 验证",
      description: deliveryItems.every((item) => item.value === "可打开") ? "真实链接已生成。" : "仍有产物需要检查链接状态。",
      tone: deliveryItems.every((item) => item.value === "可打开") ? "good" : "warn",
      state: "验收"
    });
  } else {
    actions.push({
      title: "等待 Agent 执行完成",
      description: "过程事件会实时刷新到流水线和事件日志。",
      tone: "neutral",
      state: "执行中"
    });
  }

  if (readiness?.checks.some((check) => !check.ok && !check.required)) {
    actions.push({
      title: "补齐建议项",
      description: "机器人自身 ID 和事件安全项仍可继续强化。",
      tone: "warn",
      state: "建议"
    });
  }

  return actions;
}

function getStageStatus(task: Task | undefined, tool: string) {
  if (!task) return "pending";
  if (tool === "planner" && task.plan) return "completed";
  const step = task.plan?.steps.find((item) => item.tool === tool);
  return step?.status ?? "pending";
}

function getArtifactLinkState(artifact: Artifact) {
  if (!artifact.url) return { label: "无链接", value: "内容已生成", tone: "warn" as const };
  if (artifact.url.startsWith("mock://")) return { label: "模拟链接", value: "模拟交付", tone: "warn" as const };
  return { label: "真实链接", value: "可打开", tone: "good" as const };
}
