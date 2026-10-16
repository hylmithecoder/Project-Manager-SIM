"use client";

import { useMemo, useState } from "react";
import {
  BoardIcon,
  ChatIcon,
  CheckCircleIcon,
  LinkIcon,
  LockIcon,
  PlusIcon,
  RocketIcon,
  SendIcon,
  ThumbUpIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import type {
  RoomDto,
  WorkspaceSnapshot,
  WsAction,
} from "@/server/ws/protocol";

const REACTION_CONFIG: Record<
  string,
  { label: string; renderIcon: () => React.ReactNode }
> = {
  "👍": {
    label: "Setuju",
    renderIcon: () => <ThumbUpIcon className="h-3 w-3 text-primary" />,
  },
  "🚀": {
    label: "Luncurkan",
    renderIcon: () => <RocketIcon className="h-3 w-3 text-accent-text" />,
  },
  "✅": {
    label: "Selesai",
    renderIcon: () => <CheckCircleIcon className="h-3 w-3 text-success" />,
  },
};

interface ChatRoomViewProps {
  snapshot: WorkspaceSnapshot;
  activeRoom: RoomDto | null;
  onSelectRoom: (roomId: string) => void;
  currentUserId: string;
  isCurrentUserAdmin: boolean;
  sendWsAction: (action: WsAction, payload?: Record<string, unknown>) => void;
}

export function ChatRoomView({
  snapshot,
  activeRoom,
  onSelectRoom,
  currentUserId,
  isCurrentUserAdmin,
  sendWsAction,
}: ChatRoomViewProps) {
  const [newRoomName, setNewRoomName] = useState("");
  const [messageInput, setMessageInput] = useState("");

  const usersMap = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    for (const u of snapshot?.users || []) {
      map.set(u.id, { name: u.name, email: u.email });
    }
    return map;
  }, [snapshot]);

  const roomMessages = useMemo(() => {
    if (!activeRoom) return [];
    return (snapshot?.messages || [])
      .filter((m) => m.room_id === activeRoom.id)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
  }, [snapshot, activeRoom]);

  const isRoomRestricted = Boolean(
    activeRoom?.only_admins_can_send && !isCurrentUserAdmin,
  );

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeRoom || isRoomRestricted) return;
    sendWsAction("message:send", {
      room_id: activeRoom.id,
      sender_id: currentUserId,
      content: messageInput.trim(),
      type: "text",
    });
    setMessageInput("");
  };

  const handleConvertMessageToTask = (messageId: string, content: string) => {
    const defaultBoard = snapshot?.boards?.[0];
    const defaultList = snapshot?.lists?.find(
      (l) => l.board_id === defaultBoard?.id && !l.archived_at,
    );

    if (!defaultBoard || !defaultList) {
      alert("Belum ada kolom list aktif untuk menampung task baru.");
      return;
    }

    sendWsAction("card:from_message", {
      message_id: messageId,
      board_id: defaultBoard.id,
      list_id: defaultList.id,
      title: content.slice(0, 80),
      description: `Dibuat dari pesan obrolan di ruang ${activeRoom?.name || ""}:\n"${content}"`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Room & Room Selector Section */}
      <section className="rounded-card border border-line bg-bg p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-ink">
                {activeRoom?.name || "Ruang Chat"}
              </h1>
              {activeRoom?.only_admins_can_send && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-bold text-danger">
                  <LockIcon className="h-3 w-3" />
                  Hanya Admin
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Tipe:{" "}
              <strong className="text-ink font-semibold">
                {activeRoom?.type || "group"}
              </strong>{" "}
              · Pesan otomatis <code className="text-primary font-mono">task_event</code> masuk saat status card berubah.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Nama ruang baru..."
              className="h-9 rounded-card border border-line bg-floor px-3 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!newRoomName.trim()) return;
                sendWsAction("room:create", {
                  name: newRoomName.trim(),
                  type: "group",
                });
                setNewRoomName("");
              }}
              className="!h-9 !px-3 !text-xs font-semibold"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Buat Ruang
            </Button>
          </div>
        </div>

        {/* Room Switcher Pills */}
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {(snapshot?.rooms || []).map((r) => {
            const isSelected = activeRoom?.id === r.id;
            const IconComp =
              r.type === "board" ? BoardIcon : r.type === "card" ? LinkIcon : ChatIcon;

            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRoom(r.id)}
                className={`flex items-center gap-1.5 rounded-card px-3 py-1.5 text-xs font-semibold transition ${
                  isSelected
                    ? "bg-primary text-on-primary"
                    : "border border-line bg-floor text-ink hover:border-primary hover:text-primary"
                }`}
              >
                <IconComp className="h-3.5 w-3.5" />
                <span>{r.name || "Ruang Chat"}</span>
                {r.only_admins_can_send && (
                  <LockIcon className="h-3 w-3 opacity-70" />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Chat Messages Container */}
      <section className="flex flex-col rounded-card border border-line bg-bg shadow-soft overflow-hidden">
        {/* Messages List Area */}
        <div className="flex-1 min-h-[380px] max-h-[520px] overflow-y-auto p-4 md:p-6 space-y-4">
          {roomMessages.length === 0 ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-xs text-muted">
              <ChatIcon className="h-8 w-8 text-muted mb-2 opacity-50" />
              <p>Belum ada pesan di ruang obrolan ini.</p>
              <p className="text-[11px] mt-0.5">Mulai percakapan dengan mengirim pesan di bawah.</p>
            </div>
          ) : (
            roomMessages.map((msg) => {
              const sender = msg.sender_id ? usersMap.get(msg.sender_id) : null;
              const isMe = msg.sender_id === currentUserId;
              const isTaskEvent = msg.type === "task_event";

              if (isTaskEvent) {
                return (
                  <div
                    key={msg.id}
                    className="flex justify-center my-2"
                  >
                    <div className="rounded-full border border-primary/20 bg-primary-soft/50 px-3.5 py-1 text-[11px] font-medium text-primary">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              const reactionCounts: Record<string, number> = {};
              for (const r of msg.reactions || []) {
                reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
              }

              return (
                <div
                  key={msg.id}
                  className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Sender Avatar */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                    {sender?.name ? sender.name.charAt(0).toUpperCase() : "U"}
                  </div>

                  {/* Message Bubble & Details */}
                  <div className={`max-w-[80%] space-y-1 ${isMe ? "items-end text-right" : "items-start text-left"}`}>
                    <div className="flex items-center gap-2 text-[11px] text-muted">
                      <span className="font-semibold text-ink">
                        {isMe ? "Saya" : sender?.name || "Anggota"}
                      </span>
                      <span>
                        {new Date(msg.created_at).toLocaleTimeString("id-ID", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    <div
                      className={`rounded-card px-3.5 py-2.5 text-xs ${
                        isMe
                          ? "bg-primary text-on-primary rounded-tr-none"
                          : "border border-line bg-floor text-ink rounded-tl-none"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>

                    {/* Reactions & Actions Row */}
                    <div className={`flex flex-wrap items-center gap-1.5 pt-0.5 ${isMe ? "justify-end" : "justify-start"}`}>
                      {/* Existing Reactions */}
                      {Object.entries(reactionCounts).map(
                        ([reactionCode, count]) => {
                          const config = REACTION_CONFIG[reactionCode];
                          if (!config) return null;
                          return (
                            <button
                              key={reactionCode}
                              type="button"
                              onClick={() =>
                                sendWsAction("message:react", {
                                  message_id: msg.id,
                                  reaction: reactionCode,
                                })
                              }
                              className="flex items-center gap-1 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] text-ink hover:border-primary"
                            >
                              {config.renderIcon()}
                              <span className="font-semibold">{count}</span>
                            </button>
                          );
                        },
                      )}

                      {/* Add Reaction Buttons */}
                      {Object.entries(REACTION_CONFIG).map(
                        ([reactionCode, config]) => (
                          <button
                            key={reactionCode}
                            type="button"
                            onClick={() =>
                              sendWsAction("message:react", {
                                message_id: msg.id,
                                reaction: reactionCode,
                              })
                            }
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-bg text-muted hover:border-primary hover:text-primary transition"
                            title={`Beri reaksi ${config.label}`}
                          >
                            {config.renderIcon()}
                          </button>
                        ),
                      )}

                      {/* Convert to Task Button */}
                      <button
                        type="button"
                        onClick={() =>
                          handleConvertMessageToTask(msg.id, msg.content || "")
                        }
                        className="flex items-center gap-1 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] text-muted hover:border-primary hover:text-primary transition"
                        title="Jadikan pesan ini sebagai tugas baru di papan Kanban"
                      >
                        <LinkIcon className="h-3 w-3" />
                        <span>Jadikan Task</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Message Input Footer */}
        <div className="border-t border-line bg-floor/40 p-4">
          {isRoomRestricted ? (
            <div className="flex items-center gap-2 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
              <LockIcon className="h-4 w-4 shrink-0" />
              <span>
                Ruang ini dibatasi oleh administrator. Hanya admin yang dapat mengirim pesan.
              </span>
            </div>
          ) : (
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder={`Tulis pesan di #${activeRoom?.name || "obrolan"}...`}
                className="h-10 w-full rounded-card border border-line bg-bg px-3.5 text-xs text-ink placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={!messageInput.trim()}
                className="flex h-10 items-center gap-1.5 rounded-card bg-primary px-4 text-xs font-semibold text-on-primary transition hover:bg-primary-strong disabled:opacity-50"
              >
                <SendIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Kirim</span>
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
