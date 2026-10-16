"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProductivityIllustration } from "@/components/illustrations/productivity";
import { Button } from "@/components/ui/button";
import type {
  WorkspaceSnapshot,
  WsAction,
  WsBroadcastEvent,
  WsResponseMessage,
} from "@/server/ws/protocol";

function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (e.g. http://0.0.0.0:5790 or direct IP access)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function resolveWsUrl(): string {
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    if (window.location.port && window.location.port !== "3000") {
      return `${proto}//${window.location.host}/ws`;
    }
    return (
      process.env.NEXT_PUBLIC_WS_URL ||
      `${proto}//${window.location.hostname}:5790/ws`
    );
  }
  return process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:5790/ws";
}

export function BoardChatWorkspace() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [theme, setTheme] = useState<"default" | "parking">("default");
  const [activeUserId, setActiveUserId] = useState<string>("");
  const [activeBoardId, setActiveBoardId] = useState<string>("");
  const [activeRoomId, setActiveRoomId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Form states — Task Board CRUD
  const [newBoardName, setNewBoardName] = useState("");
  const [newListName, setNewListName] = useState("");
  const [newCardTitleByList, setNewCardTitleByList] = useState<
    Record<string, string>
  >({});
  const [newCardDescByList, setNewCardDescByList] = useState<
    Record<string, string>
  >({});
  const [newChecklistByCard, setNewChecklistByCard] = useState<
    Record<string, string>
  >({});
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingCardTitle, setEditingCardTitle] = useState("");

  // Form states — Chat Grup CRUD
  const [newRoomName, setNewRoomName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [selectedRefCardId, setSelectedRefCardId] = useState<string>("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageContent, setEditingMessageContent] = useState("");

  const wsRef = useRef<WebSocket | null>(null);

  const applyTheme = useCallback((nextTheme: "default" | "parking") => {
    setTheme(nextTheme);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", nextTheme);
    }
  }, []);

  const effectiveUserId =
    activeUserId || snapshot?.users[0]?.id || "";

  const sendWsAction = useCallback(
    (action: WsAction, payload: Record<string, unknown> = {}) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatusMessage("WebSocket belum terhubung ke server Bun (port 5790).");
        return;
      }
      const req = {
        id: generateUuid(),
        action,
        payload: {
          actor_id: effectiveUserId || undefined,
          ...payload,
        },
      };
      ws.send(JSON.stringify(req));
    },
    [effectiveUserId],
  );

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      const ws = new WebSocket(resolveWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setWsConnected(true);
        setStatusMessage(null);
      };

      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(String(evt.data)) as
            | WsBroadcastEvent
            | WsResponseMessage;

          if ("type" in parsed && parsed.type === "event" && parsed.snapshot) {
            setSnapshot(parsed.snapshot);
          } else if (
            "type" in parsed &&
            parsed.type === "response" &&
            !parsed.ok
          ) {
            setStatusMessage(parsed.error || "Operasi gagal dijalankan");
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const activeBoard = useMemo(
    () =>
      snapshot?.boards.find((b) => b.id === activeBoardId) ||
      snapshot?.boards[0] ||
      null,
    [snapshot, activeBoardId],
  );

  const boardLists = useMemo(
    () =>
      (snapshot?.lists || []).filter(
        (l) => !activeBoard || l.board_id === activeBoard.id,
      ),
    [snapshot, activeBoard],
  );

  const boardCards = useMemo(
    () =>
      (snapshot?.cards || []).filter(
        (c) => !activeBoard || c.board_id === activeBoard.id,
      ),
    [snapshot, activeBoard],
  );

  const activeRoom = useMemo(
    () =>
      snapshot?.rooms.find((r) => r.id === activeRoomId) ||
      snapshot?.rooms[0] ||
      null,
    [snapshot, activeRoomId],
  );

  const roomMessages = useMemo(
    () =>
      (snapshot?.messages || []).filter(
        (m) => activeRoom && m.room_id === activeRoom.id,
      ),
    [snapshot, activeRoom],
  );

  const userMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of snapshot?.users || []) {
      map.set(u.id, u.name);
    }
    return map;
  }, [snapshot]);

  const labelMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const l of snapshot?.labels || []) {
      map.set(l.id, { name: l.name, color: l.color });
    }
    return map;
  }, [snapshot]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {/* Hero & Kontrol Tema / Koneksi WebSocket */}
      <header className="rounded-card border border-line bg-bg p-6 shadow-soft">
        <div className="grid items-center gap-6 md:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-accent-text">
                Task Board + Chat Grup Terintegrasi
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
                <span
                  className={`h-2 w-2 rounded-full ${
                    wsConnected ? "bg-success" : "bg-danger"
                  }`}
                />
                {wsConnected
                  ? "WebSocket Terhubung (Realtime CRUD)"
                  : "Menyambungkan WebSocket..."}
              </span>
            </div>

            <h1 className="mt-2 text-[29px] font-extrabold leading-9 text-ink md:text-4xl">
              {snapshot?.workspaces[0]?.name || "Management System"}
            </h1>
            <p className="mt-2.5 text-[15px] leading-[1.55] text-muted">
              Task board dan chat grup berbagi satu basis data PostgreSQL (21
              tabel UUID) dengan sinkronisasi dua arah via Bun WebSocket: pesan
              chat dapat diubah langsung menjadi card, dan aktivitas card
              otomatis tercatat sebagai pesan{" "}
              <code className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-accent-text">
                task_event
              </code>{" "}
              di ruang diskusi board.
            </p>

            {/* Baris Pemilih User Aktif & Tema */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-btn border border-line bg-floor/50 px-3 py-2">
                <span className="text-[12.5px] font-medium text-subtle">
                  Aktor Aktif:
                </span>
                <select
                  aria-label="Pilih pengguna aktif"
                  value={effectiveUserId}
                  onChange={(e) => setActiveUserId(e.target.value)}
                  className="bg-transparent text-sm font-semibold text-ink focus:outline-none"
                >
                  {(snapshot?.users || []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={theme === "default" ? "primary" : "outline"}
                  onClick={() => applyTheme("default")}
                  className="!h-[44px] !w-auto !px-4 !text-sm"
                >
                  Tema Biru (Default)
                </Button>
                <Button
                  type="button"
                  variant={theme === "parking" ? "primary" : "outline"}
                  onClick={() => applyTheme("parking")}
                  className="!h-[44px] !w-auto !px-4 !text-sm"
                >
                  Tema Kuning (Parking)
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center rounded-card bg-primary-soft/60 p-4">
            <ProductivityIllustration className="w-full max-w-[260px]" />
          </div>
        </div>

        {/* Statistik Ringkas (4 Kartu sesuai pola Dashboard SKILL.md) */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card border border-line bg-bg p-4 shadow-soft">
            <p className="text-[12.5px] font-medium text-subtle">
              Total Kolom &amp; Card
            </p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {boardLists.length} List · {boardCards.length} Card
            </p>
            <span className="mt-2 inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
              Modul Task Board
            </span>
          </div>

          <div className="rounded-card border border-line bg-bg p-4 shadow-soft">
            <p className="text-[12.5px] font-medium text-subtle">
              Ruang Diskusi &amp; Pesan
            </p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {snapshot?.rooms.length || 0} Room ·{" "}
              {snapshot?.messages.length || 0} Pesan
            </p>
            <span className="mt-2 inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
              Modul Chat Grup
            </span>
          </div>

          <div className="rounded-card border border-line bg-bg p-4 shadow-soft">
            <p className="text-[12.5px] font-medium text-subtle">
              Card dari Pesan Chat
            </p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {boardCards.filter((c) => Boolean(c.source_message_id)).length}{" "}
              Terhubung
            </p>
            <span className="mt-2 inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
              cards.source_message_id
            </span>
          </div>

          <div className="rounded-card border border-line bg-bg p-4 shadow-soft">
            <p className="text-[12.5px] font-medium text-subtle">
              Log Aktivitas &amp; Notifikasi
            </p>
            <p className="mt-1 text-2xl font-bold text-ink">
              {snapshot?.activities.length || 0} Event
            </p>
            <span className="mt-2 inline-flex items-center rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
              Lintas Modul
            </span>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 flex items-center justify-between rounded-btn border border-danger bg-primary-soft px-4 py-3 text-sm font-semibold text-danger">
            <span>{statusMessage}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-xs underline"
            >
              Tutup
            </button>
          </div>
        )}
      </header>

      {/* Pemilih Board & Tambah Board / Kolom List Baru */}
      <section className="mt-6 rounded-card border border-line bg-bg p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-bold uppercase tracking-[0.18em] text-accent-text">
              Board Aktif:
            </span>
            {(snapshot?.boards || []).map((b) => (
              <Button
                key={b.id}
                type="button"
                variant={activeBoard?.id === b.id ? "primary" : "outline"}
                onClick={() => {
                  setActiveBoardId(b.id);
                  if (b.room_id) setActiveRoomId(b.room_id);
                }}
                className="!h-[44px] !w-auto !px-4 !text-sm"
              >
                {b.name}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="Nama board baru..."
              className="h-[44px] rounded-btn border-[1.5px] border-line bg-bg px-3.5 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!newBoardName.trim()) return;
                sendWsAction("board:create", { name: newBoardName.trim() });
                setNewBoardName("");
              }}
              className="!h-[44px] !w-auto !px-4 !text-sm"
            >
              + Buat Board
            </Button>

            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Tambah kolom list..."
              className="h-[44px] rounded-btn border-[1.5px] border-line bg-bg px-3.5 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20"
            />
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (!newListName.trim() || !activeBoard) return;
                sendWsAction("list:create", {
                  board_id: activeBoard.id,
                  name: newListName.trim(),
                });
                setNewListName("");
              }}
              className="!h-[44px] !w-auto !px-4 !text-sm"
            >
              + Tambah List
            </Button>
          </div>
        </div>
      </section>

      {/* Grid Utama: Kiri = Kanban Task Board (3 kolom), Kanan = Chat Grup Terintegrasi */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.35fr_0.85fr]">
        {/* PANEL KIRI: MODUL TASK BOARD */}
        <section className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {boardLists.map((list) => {
              const cardsInList = boardCards.filter(
                (c) => c.list_id === list.id,
              );
              return (
                <div
                  key={list.id}
                  className="flex flex-col rounded-card border border-line bg-floor/50 p-3.5 shadow-soft"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-extrabold text-ink">
                        {list.name}
                      </h2>
                      <span className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-accent-text">
                        {cardsInList.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        sendWsAction("list:delete", { list_id: list.id })
                      }
                      title="Arsipkan kolom list"
                      className="text-xs font-semibold text-subtle hover:text-danger"
                    >
                      Arsip
                    </button>
                  </div>

                  {/* Daftar Card di dalam List */}
                  <div className="space-y-3">
                    {cardsInList.map((card) => {
                      const isEditing = editingCardId === card.id;
                      const doneCount = card.checklist_items.filter(
                        (i) => i.is_done,
                      ).length;

                      return (
                        <article
                          key={card.id}
                          className="rounded-card border border-line bg-bg p-3.5 shadow-soft"
                        >
                          {/* Baris Label & Status Selesai */}
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            {card.label_ids.map((lid) => {
                              const lbl = labelMap.get(lid);
                              if (!lbl) return null;
                              return (
                                <span
                                  key={lid}
                                  className="inline-flex items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent-text"
                                >
                                  {lbl.name}
                                </span>
                              );
                            })}
                            {card.source_message_id && (
                              <span className="inline-flex items-center rounded-full bg-floor px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                                Dari Chat
                              </span>
                            )}
                            {card.completed_at && (
                              <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-success">
                                ✓ Selesai
                              </span>
                            )}
                          </div>

                          {/* Judul Card / Edit Inline */}
                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={editingCardTitle}
                                onChange={(e) =>
                                  setEditingCardTitle(e.target.value)
                                }
                                className="h-[44px] w-full rounded-btn border-[1.5px] border-line bg-bg px-3 text-sm text-ink focus:border-primary focus:outline-none"
                              />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="primary"
                                  onClick={() => {
                                    sendWsAction("card:update", {
                                      card_id: card.id,
                                      title: editingCardTitle,
                                    });
                                    setEditingCardId(null);
                                  }}
                                  className="!h-[44px] !px-3 !text-xs"
                                >
                                  Simpan
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  onClick={() => setEditingCardId(null)}
                                  className="!h-[44px] !px-3 !text-xs"
                                >
                                  Batal
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <h3 className="text-sm font-bold leading-snug text-ink">
                              {card.title}
                            </h3>
                          )}

                          {card.description && (
                            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                              {card.description}
                            </p>
                          )}

                          {/* Checklist dalam Card */}
                          <div className="mt-3 border-t border-line pt-2.5">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-[12px] font-semibold text-subtle">
                                Checklist ({doneCount}/
                                {card.checklist_items.length})
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  sendWsAction("card:update", {
                                    card_id: card.id,
                                    completed: !card.completed_at,
                                  })
                                }
                                className="text-[11px] font-semibold text-accent-text hover:underline"
                              >
                                {card.completed_at
                                  ? "Buka Kembali"
                                  : "Tandai Selesai"}
                              </button>
                            </div>

                            <ul className="space-y-1">
                              {card.checklist_items.map((item) => (
                                <li
                                  key={item.id}
                                  className="flex items-center justify-between gap-2 text-xs"
                                >
                                  <label className="flex cursor-pointer items-center gap-2 text-ink">
                                    <input
                                      type="checkbox"
                                      checked={item.is_done}
                                      onChange={() =>
                                        sendWsAction("checklist:toggle_item", {
                                          item_id: item.id,
                                        })
                                      }
                                      className="h-3.5 w-3.5 accent-primary"
                                    />
                                    <span
                                      className={
                                        item.is_done
                                          ? "line-through text-subtle"
                                          : "text-ink"
                                      }
                                    >
                                      {item.content}
                                    </span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      sendWsAction("checklist:delete_item", {
                                        item_id: item.id,
                                      })
                                    }
                                    className="text-[11px] text-subtle hover:text-danger"
                                  >
                                    ×
                                  </button>
                                </li>
                              ))}
                            </ul>

                            <div className="mt-2 flex gap-1.5">
                              <input
                                type="text"
                                value={newChecklistByCard[card.id] || ""}
                                onChange={(e) =>
                                  setNewChecklistByCard((prev) => ({
                                    ...prev,
                                    [card.id]: e.target.value,
                                  }))
                                }
                                placeholder="+ Item checklist..."
                                className="h-[36px] w-full rounded-btn border border-line bg-bg px-2.5 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const text = (
                                    newChecklistByCard[card.id] || ""
                                  ).trim();
                                  if (!text) return;
                                  sendWsAction("checklist:add_item", {
                                    card_id: card.id,
                                    content: text,
                                  });
                                  setNewChecklistByCard((prev) => ({
                                    ...prev,
                                    [card.id]: "",
                                  }));
                                }}
                                className="rounded-btn bg-primary-soft px-2.5 text-xs font-semibold text-accent-text hover:bg-primary hover:text-on-primary"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* Assignees & Kontrol Pindah Kolom / Edit / Hapus */}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                            <div className="flex flex-wrap gap-1">
                              {card.assignee_ids.map((uid) => (
                                <span
                                  key={uid}
                                  className="rounded-full bg-floor px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
                                >
                                  {userMap.get(uid) || "Member"}
                                </span>
                              ))}
                            </div>

                            <div className="flex items-center gap-1.5">
                              <select
                                aria-label={`Pindahkan ${card.title}`}
                                value={card.list_id}
                                onChange={(e) =>
                                  sendWsAction("card:move", {
                                    card_id: card.id,
                                    target_list_id: e.target.value,
                                  })
                                }
                                className="rounded-btn border border-line bg-floor px-2 py-1 text-[11px] font-semibold text-ink focus:border-primary focus:outline-none"
                              >
                                {boardLists.map((target) => (
                                  <option key={target.id} value={target.id}>
                                    → {target.name}
                                  </option>
                                ))}
                              </select>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCardId(card.id);
                                  setEditingCardTitle(card.title);
                                }}
                                className="rounded-btn px-2 py-1 text-[11px] font-semibold text-accent-text hover:bg-primary-soft"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  sendWsAction("card:delete", {
                                    card_id: card.id,
                                  })
                                }
                                className="rounded-btn px-2 py-1 text-[11px] font-semibold text-danger hover:bg-primary-soft"
                              >
                                Hapus
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {/* Form Tambah Card di Kolom Ini */}
                  <div className="mt-3 space-y-2 rounded-card border border-line bg-bg p-3">
                    <input
                      type="text"
                      value={newCardTitleByList[list.id] || ""}
                      onChange={(e) =>
                        setNewCardTitleByList((prev) => ({
                          ...prev,
                          [list.id]: e.target.value,
                        }))
                      }
                      placeholder={`Tambah card ke ${list.name}...`}
                      className="h-[44px] w-full rounded-btn border-[1.5px] border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newCardDescByList[list.id] || ""}
                      onChange={(e) =>
                        setNewCardDescByList((prev) => ({
                          ...prev,
                          [list.id]: e.target.value,
                        }))
                      }
                      placeholder="Deskripsi singkat (opsional)..."
                      className="h-[38px] w-full rounded-btn border border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
                    />
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        const title = (newCardTitleByList[list.id] || "").trim();
                        if (!title || !activeBoard) return;
                        sendWsAction("card:create", {
                          board_id: activeBoard.id,
                          list_id: list.id,
                          title,
                          description: (
                            newCardDescByList[list.id] || ""
                          ).trim(),
                        });
                        setNewCardTitleByList((prev) => ({
                          ...prev,
                          [list.id]: "",
                        }));
                        setNewCardDescByList((prev) => ({
                          ...prev,
                          [list.id]: "",
                        }));
                      }}
                      className="!h-[44px] !text-xs"
                    >
                      + Tambah Card
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* PANEL KANAN: MODUL CHAT GRUP TERINTEGRASI */}
        <aside className="rounded-card border border-line bg-bg p-4 shadow-soft">
          <div className="border-b border-line pb-3">
            <p className="text-[13px] font-bold uppercase tracking-[0.18em] text-accent-text">
              Modul Chat Grup Terintegrasi
            </p>
            <h2 className="mt-1 text-xl font-extrabold text-ink">
              {activeRoom?.name || "Ruang Chat"}
            </h2>
            <p className="mt-0.5 text-[12.5px] font-medium text-subtle">
              Tipe room:{" "}
              <strong className="text-ink">{activeRoom?.type || "-"}</strong> ·
              Pesan sistem{" "}
              <code className="text-accent-text">task_event</code> masuk
              otomatis saat card berubah.
            </p>

            {/* Daftar Pilihan Room */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(snapshot?.rooms || []).map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setActiveRoomId(room.id)}
                  className={`min-h-[38px] rounded-btn px-3 py-1.5 text-xs font-semibold transition ${
                    activeRoom?.id === room.id
                      ? "bg-primary text-on-primary shadow-glow"
                      : "border border-line bg-floor/60 text-ink hover:bg-primary-soft"
                  }`}
                >
                  {room.type === "board"
                    ? "📋 "
                    : room.type === "card"
                      ? "🗂️ "
                      : "💬 "}
                  {room.name || "Direct Message"}
                </button>
              ))}
            </div>

            {/* Buat Room Grup Baru */}
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Buat room grup baru..."
                className="h-[44px] w-full rounded-btn border-[1.5px] border-line bg-bg px-3 text-xs text-ink placeholder:text-subtle focus:border-primary focus:outline-none"
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
                className="!h-[44px] !w-auto !px-3.5 !text-xs"
              >
                + Room
              </Button>
            </div>
          </div>

          {/* Aliran Pesan Chat */}
          <div className="mt-4 max-h-[460px] space-y-3 overflow-y-auto pr-1">
            {roomMessages.map((msg) => {
              const isTaskEvent = msg.type === "task_event";
              const isDeleted = Boolean(msg.deleted_at);
              const isEditingMsg = editingMessageId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`rounded-card border p-3 ${
                    isTaskEvent
                      ? "border-primary bg-primary-soft/70"
                      : "border-line bg-floor/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ink">
                      {isTaskEvent
                        ? "⚡ Task Event (Otomatis)"
                        : msg.sender_name || "Sistem"}
                    </span>
                    <span className="text-[11px] text-subtle">
                      {new Date(msg.created_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {msg.edited_at && !isDeleted ? " (diedit)" : ""}
                    </span>
                  </div>

                  {/* Badge Rujukan Card (messages.card_id) */}
                  {msg.card_id && msg.card_title && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent-text">
                      <span>🔗 Merujuk Card:</span>
                      <strong className="text-ink">{msg.card_title}</strong>
                    </div>
                  )}

                  {isEditingMsg ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={editingMessageContent}
                        onChange={(e) =>
                          setEditingMessageContent(e.target.value)
                        }
                        className="h-[44px] w-full rounded-btn border border-line bg-bg px-3 text-xs text-ink"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="primary"
                          onClick={() => {
                            sendWsAction("message:update", {
                              message_id: msg.id,
                              content: editingMessageContent,
                            });
                            setEditingMessageId(null);
                          }}
                          className="!h-[44px] !px-3 !text-xs"
                        >
                          Simpan
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditingMessageId(null)}
                          className="!h-[44px] !px-3 !text-xs"
                        >
                          Batal
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className={`mt-1.5 text-sm leading-relaxed ${
                        isDeleted ? "italic text-subtle" : "text-ink"
                      }`}
                    >
                      {msg.content}
                    </p>
                  )}

                  {/* Reaksi Emoji & Tombol Integrasi Pesan -> Card */}
                  {!isDeleted && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2">
                      <div className="flex items-center gap-1.5">
                        {["👍", "🚀", "✅"].map((emoji) => {
                          const count = msg.reactions.filter(
                            (r) => r.emoji === emoji,
                          ).length;
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() =>
                                sendWsAction("message:react", {
                                  message_id: msg.id,
                                  emoji,
                                })
                              }
                              className="rounded-full border border-line bg-bg px-2 py-0.5 text-[11px] font-semibold text-ink hover:bg-primary-soft"
                            >
                              {emoji} {count > 0 ? count : ""}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-2">
                        {!isTaskEvent && (
                          <button
                            type="button"
                            onClick={() => {
                              const firstList = boardLists[0];
                              if (!firstList || !activeBoard) return;
                              sendWsAction("card:from_message", {
                                message_id: msg.id,
                                board_id: activeBoard.id,
                                list_id: firstList.id,
                              });
                            }}
                            className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-accent-text hover:bg-primary hover:text-on-primary"
                          >
                            + Jadikan Card
                          </button>
                        )}
                        {!isTaskEvent && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMessageId(msg.id);
                                setEditingMessageContent(msg.content || "");
                              }}
                              className="text-[11px] font-semibold text-subtle hover:text-ink"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                sendWsAction("message:delete", {
                                  message_id: msg.id,
                                })
                              }
                              className="text-[11px] font-semibold text-subtle hover:text-danger"
                            >
                              Hapus
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Form Kirim Pesan Chat + Rujuk Card */}
          <div className="mt-4 space-y-2.5 border-t border-line pt-3">
            <select
              aria-label="Rujuk card pada pesan (opsional)"
              value={selectedRefCardId}
              onChange={(e) => setSelectedRefCardId(e.target.value)}
              className="h-[44px] w-full rounded-btn border border-line bg-floor/50 px-3 text-xs font-semibold text-ink focus:border-primary focus:outline-none"
            >
              <option value="">
                🔗 Tanpa rujukan card (atau pilih card untuk dirujuk)...
              </option>
              {boardCards.map((c) => (
                <option key={c.id} value={c.id}>
                  Rujuk Card: {c.title}
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && chatInput.trim() && activeRoom) {
                    sendWsAction("message:send", {
                      room_id: activeRoom.id,
                      content: chatInput.trim(),
                      card_id: selectedRefCardId || null,
                    });
                    setChatInput("");
                    setSelectedRefCardId("");
                  }
                }}
                placeholder="Tulis pesan ke ruang chat..."
                className="h-[52px] w-full rounded-btn border-[1.5px] border-line bg-bg px-4 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/20"
              />
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  if (!chatInput.trim() || !activeRoom) return;
                  sendWsAction("message:send", {
                    room_id: activeRoom.id,
                    content: chatInput.trim(),
                    card_id: selectedRefCardId || null,
                  });
                  setChatInput("");
                  setSelectedRefCardId("");
                }}
                className="!h-[52px] !w-auto !px-5 !text-sm"
              >
                Kirim
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
