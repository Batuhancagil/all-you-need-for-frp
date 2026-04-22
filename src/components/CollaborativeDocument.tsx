"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";

type Props = {
  roomId: string;
  participantId?: string | null;
  displayName?: string | null;
  readOnly?: boolean;
};

type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type DocumentPayload = {
  title: string;
  yjsState: string | null;
  updatedAt: string | null;
};

type AwarenessUser = {
  name: string;
  color: string;
};

const AWARENESS_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#10b981",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

function pickColor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AWARENESS_COLORS[Math.abs(hash) % AWARENESS_COLORS.length];
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof window === "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof window === "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function CollaborativeDocument({
  roomId,
  participantId,
  displayName,
  readOnly = false,
}: Props) {
  const [title, setTitle] = useState("Untitled");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<AwarenessUser[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebrtcProvider | null>(null);
  const applyingRemoteRef = useRef(false);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStateRef = useRef<Uint8Array | null>(null);
  const latestTitleRef = useRef<string>("Untitled");
  const dirtyRef = useRef(false);

  const awarenessUser = useMemo<AwarenessUser>(() => {
    const name = (displayName ?? "Anonymous").trim() || "Anonymous";
    return { name, color: pickColor(name + (participantId ?? "")) };
  }, [displayName, participantId]);

  const saveSnapshotRef = useRef<() => Promise<void>>(async () => undefined);

  const scheduleSnapshot = useCallback(() => {
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
    }
    snapshotTimerRef.current = setTimeout(() => {
      void saveSnapshotRef.current();
    }, 2500);
  }, []);

  const saveSnapshot = useCallback(async () => {
    if (!dirtyRef.current) return;
    const state = latestStateRef.current;
    if (!state) return;
    dirtyRef.current = false;
    try {
      const body: Record<string, unknown> = {
        participantId: participantId ?? undefined,
        yjsState: uint8ArrayToBase64(state),
        title: latestTitleRef.current,
      };
      const res = await fetch(`/api/rooms/${roomId}/document`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as ApiResponse<{ updatedAt: string }>;
      if (payload.error) {
        throw new Error(payload.error.message);
      }
      if (payload.data?.updatedAt) {
        setLastSavedAt(payload.data.updatedAt);
      }
    } catch (snapshotError) {
      dirtyRef.current = true;
      setError(
        snapshotError instanceof Error ? snapshotError.message : "Failed to save document"
      );
    }
  }, [participantId, roomId]);

  useEffect(() => {
    saveSnapshotRef.current = saveSnapshot;
  }, [saveSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const yText = ydoc.getText("content");
    const yTitle = ydoc.getText("title");

    async function init() {
      try {
        const res = await fetch(
          `/api/rooms/${roomId}/document${participantId ? `?participantId=${encodeURIComponent(participantId)}` : ""}`,
          { cache: "no-store" }
        );
        const payload = (await res.json()) as ApiResponse<DocumentPayload>;
        if (cancelled) return;
        if (payload.error || !payload.data) {
          throw new Error(payload.error?.message ?? "Failed to load document");
        }

        if (payload.data.yjsState) {
          try {
            Y.applyUpdate(ydoc, base64ToUint8Array(payload.data.yjsState));
          } catch {
            // ignore malformed snapshot; start fresh
          }
        }

        if (yTitle.length === 0 && payload.data.title) {
          yTitle.insert(0, payload.data.title);
        }

        const provider = new WebrtcProvider(`aynfrp-room-${roomId}`, ydoc, {
          signaling: [
            "wss://signaling.yjs.dev",
            "wss://y-webrtc-signaling-eu.herokuapp.com",
          ],
        });
        providerRef.current = provider;
        provider.awareness.setLocalStateField("user", awarenessUser);

        const updateAwareness = () => {
          const states = Array.from(provider.awareness.getStates().values())
            .map((state) => state?.user as AwarenessUser | undefined)
            .filter((user): user is AwarenessUser => Boolean(user?.name));
          setPeers(states);
        };
        provider.awareness.on("change", updateAwareness);
        updateAwareness();

        const updateText = () => {
          applyingRemoteRef.current = true;
          setText(yText.toString());
          applyingRemoteRef.current = false;
        };
        const updateTitle = () => {
          const next = yTitle.toString() || "Untitled";
          setTitle(next);
          latestTitleRef.current = next;
        };
        yText.observe(updateText);
        yTitle.observe(updateTitle);
        updateText();
        updateTitle();

        ydoc.on("update", (_update: Uint8Array, origin: unknown) => {
          latestStateRef.current = Y.encodeStateAsUpdate(ydoc);
          if (origin !== "remote") {
            dirtyRef.current = true;
            scheduleSnapshot();
          }
        });

        latestStateRef.current = Y.encodeStateAsUpdate(ydoc);
        setLastSavedAt(payload.data.updatedAt);
        setLoading(false);
      } catch (initError) {
        if (cancelled) return;
        setError(
          initError instanceof Error ? initError.message : "Failed to load document"
        );
        setLoading(false);
      }
    }

    void init();

    const flushOnUnload = () => {
      if (dirtyRef.current) {
        // Best-effort sync save via sendBeacon.
        try {
          const state = latestStateRef.current;
          if (state && navigator.sendBeacon) {
            const body = new Blob(
              [
                JSON.stringify({
                  participantId,
                  title: latestTitleRef.current,
                  yjsState: uint8ArrayToBase64(state),
                }),
              ],
              { type: "application/json" }
            );
            navigator.sendBeacon(`/api/rooms/${roomId}/document`, body);
          }
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("beforeunload", flushOnUnload);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", flushOnUnload);
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
      }
      void saveSnapshotRef.current();
      providerRef.current?.destroy();
      providerRef.current = null;
      ydoc.destroy();
      ydocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, participantId]);

  const handleTextChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      const ydoc = ydocRef.current;
      if (!ydoc || applyingRemoteRef.current) {
        setText(next);
        return;
      }
      const yText = ydoc.getText("content");
      const current = yText.toString();
      if (current === next) {
        setText(next);
        return;
      }

      let start = 0;
      const maxLen = Math.min(current.length, next.length);
      while (start < maxLen && current.charCodeAt(start) === next.charCodeAt(start)) {
        start += 1;
      }

      let endCurrent = current.length;
      let endNext = next.length;
      while (
        endCurrent > start &&
        endNext > start &&
        current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)
      ) {
        endCurrent -= 1;
        endNext -= 1;
      }

      const deleteCount = endCurrent - start;
      const inserted = next.slice(start, endNext);

      ydoc.transact(() => {
        if (deleteCount > 0) {
          yText.delete(start, deleteCount);
        }
        if (inserted.length > 0) {
          yText.insert(start, inserted);
        }
      });

      setText(next);
    },
    []
  );

  const handleTitleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      const ydoc = ydocRef.current;
      if (!ydoc) {
        setTitle(next);
        return;
      }
      const yTitle = ydoc.getText("title");
      ydoc.transact(() => {
        yTitle.delete(0, yTitle.length);
        yTitle.insert(0, next);
      });
    },
    []
  );

  const peerBadges = useMemo(() => {
    const seen = new Map<string, AwarenessUser>();
    peers.forEach((peer) => {
      if (!seen.has(peer.name)) seen.set(peer.name, peer);
    });
    return Array.from(seen.values()).slice(0, 6);
  }, [peers]);

  return (
    <section className="app-card flex h-[calc(100vh-8rem)] flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="app-input flex-1 min-w-[240px] text-lg font-semibold"
          value={title}
          onChange={handleTitleChange}
          disabled={readOnly || loading}
          placeholder="Untitled document"
          maxLength={200}
        />
        <div className="flex items-center gap-3 text-xs text-[color:var(--foreground-muted)]">
          <div className="flex -space-x-1">
            {peerBadges.map((peer) => (
              <span
                key={peer.name}
                title={peer.name}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white dark:border-zinc-900"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          <span>
            {peerBadges.length} online
          </span>
          <span>
            {loading
              ? "Loading…"
              : lastSavedAt
              ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
              : "Unsaved"}
          </span>
        </div>
      </div>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="app-input flex-1 resize-none font-mono text-sm leading-relaxed"
        value={text}
        onChange={handleTextChange}
        disabled={readOnly || loading}
        placeholder={loading ? "Loading document…" : "Start writing…"}
        spellCheck
      />
    </section>
  );
}

export default CollaborativeDocument;
