import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { TaskStore } from "./state/TaskStore";

export function attachRealtime(server: Server, store: TaskStore) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  function broadcast(payload: unknown) {
    const message = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  }

  store.onEvent((event) => {
    broadcast({
      type: "event",
      event,
      tasks: store.listTasks()
    });
  });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "snapshot",
        tasks: store.listTasks(),
        events: store.listEvents()
      })
    );
  });

  return wss;
}

