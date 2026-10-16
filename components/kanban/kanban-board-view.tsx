"use client";

import { useMemo, useState } from "react";
import { ClockIcon, EditIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type {
  BoardDto,
  WorkspaceSnapshot,
  WsAction,
} from "@/server/ws/protocol";

interface KanbanBoardViewProps {
  snapshot: WorkspaceSnapshot;
  activeBoard: BoardDto | null;
  onSelectBoard: (boardId: string) => void;
  sendWsAction: (action: WsAction, payload?: Record<string, unknown>) => void;
}

export function KanbanBoardView({
  snapshot,
  activeBoard,
  onSelectBoard,
  sendWsAction,
}: KanbanBoardViewProps) {
  const [newBoardName, setNewBoardName] = useState("");
  const [newListName, setNewListName] = useState("");
  const [newCardTitleByList, setNewCardTitleByList] = useState<
    Record<string, string>
  >({});
  const [newCardDescByList, setNewCardDescByList] = useState<
    Record<string, string>
  >({});
  const [newChecklistTextByCard, setNewChecklistTextByCard] = useState<
    Record<string, string>
  >({});
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const boardLists = useMemo(() => {
    if (!activeBoard) return [];
    return (snapshot?.lists || [])
      .filter((l) => l.board_id === activeBoard.id && !l.archived_at)
      .sort((a, b) => a.position - b.position);
  }, [snapshot, activeBoard]);

  const boardCards = useMemo(() => {
    if (!activeBoard) return [];
    return (snapshot?.cards || [])
      .filter((c) => c.board_id === activeBoard.id && !c.archived_at)
      .sort((a, b) => a.position - b.position);
  }, [snapshot, activeBoard]);


  const labelsMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const l of snapshot?.labels || []) {
      map.set(l.id, { name: l.name, color: l.color });
    }
    return map;
  }, [snapshot]);

  return (
    <div className="space-y-6">
      {/* Board Selector & Add Board / List Section */}
      <section className="rounded-card border border-line bg-bg p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Papan Aktif:
            </span>
            {(snapshot?.boards || []).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onSelectBoard(b.id)}
                className={`rounded-card px-3.5 py-1.5 text-xs font-semibold transition ${
                  activeBoard?.id === b.id
                    ? "bg-primary text-on-primary"
                    : "border border-line bg-floor text-ink hover:border-primary hover:text-primary"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              placeholder="Nama board baru..."
              className="h-9 rounded-card border border-line bg-floor px-3 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!newBoardName.trim()) return;
                sendWsAction("board:create", { name: newBoardName.trim() });
                setNewBoardName("");
              }}
              className="!h-9 !px-3 !text-xs font-semibold"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Buat Board
            </Button>

            <input
              type="text"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="Tambah kolom list..."
              className="h-9 rounded-card border border-line bg-floor px-3 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
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
              className="!h-9 !px-3 !text-xs font-semibold"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Tambah List
            </Button>
          </div>
        </div>
      </section>

      {/* Columns Grid */}
      <section className="space-y-4">
        {boardLists.length === 0 ? (
          <div className="rounded-card border border-line bg-bg p-8 text-center text-xs text-muted">
            Belum ada kolom list pada papan ini. Buat kolom baru menggunakan form di atas.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-start">
            {boardLists.map((list) => {
              const cardsInList = boardCards.filter((c) => c.list_id === list.id);
              return (
                <div
                  key={list.id}
                  className="flex flex-col rounded-card border border-line bg-bg p-3.5 shadow-soft"
                >
                  <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-ink">{list.name}</h2>
                      <span className="inline-flex items-center rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-bold text-primary">
                        {cardsInList.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        sendWsAction("list:delete", { list_id: list.id })
                      }
                      title="Arsipkan kolom list"
                      className="text-[11px] font-semibold text-muted hover:text-danger"
                    >
                      Arsip
                    </button>
                  </div>

                  {/* List Cards */}
                  <div className="space-y-3">
                    {cardsInList.map((card) => {
                      const isEditing = editingCardId === card.id;
                      const doneCount = card.checklist_items.filter(
                        (i) => i.is_done,
                      ).length;
                      const totalChecklist = card.checklist_items.length;

                      return (
                        <div
                          key={card.id}
                          className="rounded-card border border-line bg-floor/60 p-3 text-xs transition hover:border-primary/50 hover:bg-bg"
                        >
                          {/* Label Tags */}
                          {card.label_ids.length > 0 && (
                            <div className="mb-1.5 flex flex-wrap gap-1">
                              {card.label_ids.map((lid) => {
                                const l = labelsMap.get(lid);
                                if (!l) return null;
                                return (
                                  <span
                                    key={lid}
                                    style={{
                                      backgroundColor: `${l.color}20`,
                                      borderColor: `${l.color}40`,
                                      color: l.color,
                                    }}
                                    className="rounded border px-1.5 py-0.2 text-[10px] font-bold"
                                  >
                                    {l.name}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full rounded border border-primary bg-bg p-1.5 text-xs text-ink focus:outline-none"
                              />
                              <textarea
                                value={editDesc}
                                onChange={(e) => setEditDesc(e.target.value)}
                                rows={2}
                                className="w-full rounded border border-line bg-bg p-1.5 text-xs text-ink focus:outline-none"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    sendWsAction("card:update", {
                                      card_id: card.id,
                                      title: editTitle.trim(),
                                      description: editDesc.trim(),
                                    });
                                    setEditingCardId(null);
                                  }}
                                  className="rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-on-primary"
                                >
                                  Simpan
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingCardId(null)}
                                  className="rounded border border-line px-2.5 py-1 text-[11px] text-muted hover:text-ink"
                                >
                                  Batal
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="font-semibold text-ink leading-tight">
                                  {card.title}
                                </h3>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCardId(card.id);
                                      setEditTitle(card.title);
                                      setEditDesc(card.description || "");
                                    }}
                                    className="text-muted hover:text-primary"
                                    title="Edit tugas"
                                  >
                                    <EditIcon className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      sendWsAction("card:delete", {
                                        card_id: card.id,
                                      })
                                    }
                                    className="text-muted hover:text-danger"
                                    title="Hapus tugas"
                                  >
                                    <TrashIcon className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>

                              {card.description && (
                                <p className="mt-1 text-[11px] text-muted line-clamp-2">
                                  {card.description}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Checklist Items */}
                          {totalChecklist > 0 && (
                            <div className="mt-2.5 space-y-1 border-t border-line/60 pt-2">
                              <div className="flex items-center justify-between text-[10px] font-semibold text-muted">
                                <span>Checklist</span>
                                <span>
                                  {doneCount}/{totalChecklist}
                                </span>
                              </div>
                              <div className="space-y-1">
                                {card.checklist_items.map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex items-center justify-between gap-1.5"
                                  >
                                    <label className="flex items-center gap-1.5 text-[11px] text-ink cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={item.is_done}
                                        onChange={() =>
                                          sendWsAction("checklist:toggle_item", {
                                            item_id: item.id,
                                          })
                                        }
                                        className="h-3.5 w-3.5 rounded border-line text-primary focus:ring-0"
                                      />
                                      <span
                                        className={
                                          item.is_done
                                            ? "line-through text-muted"
                                            : ""
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
                                      className="text-muted hover:text-danger"
                                      title="Hapus checklist"
                                    >
                                      <TrashIcon className="h-2.5 w-2.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Add Checklist Input */}
                          <div className="mt-2 flex gap-1">
                            <input
                              type="text"
                              value={newChecklistTextByCard[card.id] || ""}
                              onChange={(e) =>
                                setNewChecklistTextByCard((prev) => ({
                                  ...prev,
                                  [card.id]: e.target.value,
                                }))
                              }
                              placeholder="Tambah checklist..."
                              className="h-7 w-full rounded border border-line bg-bg px-2 text-[10px] text-ink placeholder:text-muted focus:border-primary focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const text =
                                  newChecklistTextByCard[card.id]?.trim();
                                if (!text) return;
                                sendWsAction("checklist:add_item", {
                                  card_id: card.id,
                                  content: text,
                                });
                                setNewChecklistTextByCard((prev) => ({
                                  ...prev,
                                  [card.id]: "",
                                }));
                              }}
                              className="rounded bg-floor border border-line px-2 text-[10px] font-semibold text-ink hover:border-primary hover:text-primary"
                            >
                              +
                            </button>
                          </div>

                          {/* Footer: Due date & Move Column */}
                          <div className="mt-2.5 flex items-center justify-between border-t border-line/60 pt-2 text-[10px] text-muted">
                            <div className="flex items-center gap-1">
                              <ClockIcon className="h-3 w-3" />
                              <span>
                                {card.due_at
                                  ? new Date(card.due_at).toLocaleDateString(
                                      "id-ID",
                                      { day: "numeric", month: "short" },
                                    )
                                  : "Tanpa due"}
                              </span>
                            </div>

                            {/* Move to another list */}
                            <select
                              value={card.list_id}
                              onChange={(e) => {
                                sendWsAction("card:move", {
                                  card_id: card.id,
                                  target_list_id: e.target.value,
                                });
                              }}
                              className="rounded border border-line bg-bg px-1.5 py-0.5 text-[10px] font-medium text-ink focus:border-primary focus:outline-none"
                            >
                              {boardLists.map((targetList) => (
                                <option key={targetList.id} value={targetList.id}>
                                  Pindah: {targetList.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Form Tambah Card Baru di Bawah Kolom */}
                  <div className="mt-3 border-t border-line pt-3 space-y-1.5">
                    <input
                      type="text"
                      value={newCardTitleByList[list.id] || ""}
                      onChange={(e) =>
                        setNewCardTitleByList((prev) => ({
                          ...prev,
                          [list.id]: e.target.value,
                        }))
                      }
                      placeholder="Judul kartu baru..."
                      className="h-8 w-full rounded border border-line bg-floor px-2.5 text-xs text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
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
                      placeholder="Keterangan singkat (opsional)..."
                      className="h-7 w-full rounded border border-line bg-floor px-2.5 text-[11px] text-ink placeholder:text-muted focus:border-primary focus:bg-bg focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const title = newCardTitleByList[list.id]?.trim();
                        if (!title || !activeBoard) return;
                        sendWsAction("card:create", {
                          board_id: activeBoard.id,
                          list_id: list.id,
                          title,
                          description:
                            newCardDescByList[list.id]?.trim() || null,
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
                      className="flex w-full items-center justify-center gap-1.5 rounded bg-primary py-1.5 text-xs font-semibold text-on-primary hover:bg-primary-strong"
                    >
                      <PlusIcon className="h-3 w-3" />
                      Tambah Kartu
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
