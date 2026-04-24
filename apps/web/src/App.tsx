import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  Monitor,
  Presentation,
  Send,
  Smartphone,
  Sparkles
} from "lucide-react";
import type { AgentEvent, Artifact, RuntimeConfig, Task } from "@agent-pilot/shared";
import { sampleDiscussion, sampleIntent } from "@agent-pilot/shared";
import { createTask, fetchRuntimeConfig, fetchTasks, sendCommand } from "./api";

type SocketMessage =
  | { type: "snapshot"; tasks: Task[]; events: AgentEvent[] }
  | { type: "event"; tasks: Task[]; event: AgentEvent };

const apiWsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8787/ws`;

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [intent, setIntent] = useState(sampleIntent);
  const [command, setCommand] = useState("把权限管理补充得更详细一点，并加上学生和老师的不同操作边界。");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [error, setError] = useState<string | null>(null);

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? tasks[0],
    [activeTaskId, tasks]
  );

  const taskEvents = useMemo(
    () => events.filter((event) => event.taskId === activeTask?.id),
    [activeTask?.id, events]
  );

  useEffect(() => {
    void fetchRuntimeConfig().then(setRuntimeConfig);
    void fetchTasks().then((items) => {
      setTasks(items);
      if (items[0]) setActiveTaskId(items[0].id);
    });
  }, []);

  useEffect(() => {
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
  }, []);

  async function handleCreateTask() {
    setError(null);
    try {
      const task = await createTask({ intent, source: "im" });
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
          <div className="dashboardGrid">
            <div className="panel taskPanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Current Task</p>
                  <h2>{activeTask?.title ?? "等待 IM 指令"}</h2>
                </div>
                {activeTask ? <TaskBadge status={activeTask.status} /> : null}
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
                    <span>{event.type}</span>
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

function PaneTitle(props: { icon: React.ReactNode; title: string; subtitle: string }) {
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

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const icon = artifact.type === "slides" ? <Presentation size={18} /> : <FileText size={18} />;
  return (
    <article className="artifactCard">
      <div className="artifactIcon">{icon}</div>
      <div>
        <strong>{artifact.title}</strong>
        <p>{artifact.type} · v{artifact.version}</p>
        <pre>{artifact.content.slice(0, 420)}</pre>
      </div>
    </article>
  );
}

