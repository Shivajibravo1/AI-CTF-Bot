"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageRow, SessionRow, UsageTotals } from "@/lib/types";

export default function Home() {
  const { data: auth, status } = useSession();

  if (status === "loading") {
    return <div className="center"><div className="card">Loading...</div></div>;
  }

  if (!auth?.user) {
    return (
      <div className="center">
        <div className="card">
          <h1 style={{ marginTop: 0 }}>CTF Assistant</h1>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>
            Advisory assistant for authorized CTF / lab challenges. Single-user access only.
          </p>
          <button onClick={() => signIn("google")}>Sign in with Google</button>
        </div>
      </div>
    );
  }

  return <Workspace email={auth.user.email || ""} />;
}

function Workspace({ email }: { email: string }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [active, setActive] = useState<SessionRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [echo, setEcho] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    const r = await fetch("/api/session");
    if (r.ok) setSessions((await r.json()).sessions || []);
  }, []);

  const loadMessages = useCallback(async (sid: number) => {
    const r = await fetch(`/api/message?session_id=${sid}`);
    if (r.ok) setMessages((await r.json()).messages || []);
    const u = await fetch(`/api/usage?session_id=${sid}`);
    if (u.ok) setTotals((await u.json()).totals);
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming]);

  async function newSession() {
    const room = prompt("Room / box name (e.g. 'THM: Blue')");
    if (!room) return;
    const platform = room.toLowerCase().includes("htb") ? "HTB" : "THM";
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_name: room, platform }),
    });
    if (r.ok) {
      const s = (await r.json()).session as SessionRow;
      await loadSessions();
      setActive(s);
      setMessages([]);
      setTotals(null);
      setEcho(null);
    }
  }

  async function selectSession(s: SessionRow) {
    setActive(s);
    setEcho(null);
    setStreaming("");
    await loadMessages(s.id);
  }

  async function closeSession() {
    if (!active) return;
    await fetch("/api/session/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: active.id }),
    });
    await loadSessions();
  }

  async function deleteSession(s: SessionRow, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete room "${s.room_name}" and all its data? This cannot be undone.`)) return;
    const r = await fetch("/api/session/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: s.id }),
    });
    if (r.ok) {
      if (active?.id === s.id) {
        setActive(null);
        setMessages([]);
        setTotals(null);
        setEcho(null);
      }
      await loadSessions();
    } else {
      alert("Could not delete the room.");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !active) return;
    setBusy(true);
    setEcho(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: active.id, image_data_url: dataUrl, filename: file.name }),
      });
      if (r.ok) {
        const { read_text } = await r.json();
        setEcho(read_text);
        await loadMessages(active.id);
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || "Vision failed. Paste the terminal text instead.");
      }
    } catch {
      alert("Could not read the image.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addPastedText() {
    if (!active || !pasteText.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: active.id, text: pasteText.trim() }),
      });
      if (r.ok) {
        setPasteText("");
        setPasteOpen(false);
        await loadMessages(active.id);
      } else {
        alert("Could not add the text.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (!active || !question.trim() || busy) return;
    const q = question.trim();
    setQuestion("");
    setBusy(true);
    setStreaming("");
    // optimistic user message
    setMessages((m) => [...m, tempMsg(active.id, "user", q)]);

    try {
      const r = await fetch("/api/reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: active.id, question: q }),
      });
      if (!r.ok || !r.body) {
        const txt = await r.text().catch(() => "Reasoning failed.");
        setStreaming("");
        setMessages((m) => [...m, tempMsg(active.id, "system", txt)]);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setStreaming(acc);
      }
      setStreaming("");
      await loadMessages(active.id);
    } catch {
      setStreaming("");
      setMessages((m) => [...m, tempMsg(active.id, "system", "Network error during reasoning.")]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">CTF Assistant<small>{email}</small></div>
        <button onClick={newSession}>+ New room</button>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${active?.id === s.id ? "active" : ""}`}
              onClick={() => selectSession(s)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div>{s.room_name}</div>
                  <div className="sub">{s.platform} · {s.closed_at ? "closed" : "open"}</div>
                </div>
                <button
                  className="ghost"
                  title="Delete room"
                  aria-label={`Delete room ${s.room_name}`}
                  style={{ padding: "2px 8px", fontSize: 12, lineHeight: 1 }}
                  onClick={(e) => deleteSession(s, e)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {sessions.length === 0 && <div className="attach-hint">No rooms yet.</div>}
        </div>
        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="disclaimer">
            For authorized CTF / lab targets only (TryHackMe, HTB, your own labs). Advisory tool: it suggests commands, you run them.
          </div>
          <button className="ghost" onClick={() => signOut()}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {!active ? (
          <div className="center">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Pick or create a room</h2>
              <p style={{ color: "var(--muted)", fontSize: 14 }}>
                Start a room, paste a screenshot, and ask what to do next.
              </p>
              <button onClick={newSession}>+ New room</button>
            </div>
          </div>
        ) : (
          <>
            <div className="topbar">
              <strong>{active.room_name}</strong>
              <span className="pill">
                <span className={`dot ${gpuDot(active.gpu_status)}`} />
                GPU: {active.gpu_status}
              </span>
              <button className="danger" style={{ padding: "6px 10px", fontSize: 12 }} onClick={closeSession}>
                Close room
              </button>
              <div className="meter">
                {totals && (
                  <>
                    <span>vision <b>${totals.vision_cost.toFixed(3)}</b></span>
                    <span>reason <b>${totals.reason_cost.toFixed(3)}</b></span>
                    <span>total <b>${totals.total_cost.toFixed(3)}</b></span>
                  </>
                )}
              </div>
            </div>

            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  <div className="who">{m.role}</div>
                  {m.content}
                </div>
              ))}
              {streaming && (
                <div className="msg reason">
                  <div className="who">reason</div>
                  {streaming}
                </div>
              )}
              <div ref={endRef} />
            </div>

            {echo && (
              <div style={{ padding: "10px 20px 0" }}>
                <div className="attach-hint" style={{ marginBottom: 4 }}>
                  Vision read this from your screenshot — confirm it looks right, then ask your question:
                </div>
                <div className="echo">{echo}</div>
              </div>
            )}

            <div className="composer">
              <div className="row">
                <textarea
                  value={question}
                  placeholder="Ask about this room… (e.g. 'what should I enumerate first?')"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
                  }}
                />
                <button className="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
                  Screenshot
                </button>
                <button className="ghost" disabled={busy} onClick={() => setPasteOpen((v) => !v)}>
                  Paste text
                </button>
                <button disabled={busy || !question.trim()} onClick={ask}>
                  {busy ? "…" : "Ask"}
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
              {pasteOpen && (
                <div className="row" style={{ marginTop: 8, alignItems: "flex-start" }}>
                  <textarea
                    value={pasteText}
                    placeholder="Paste terminal output here (e.g. nmap results) to add it to the room without a screenshot…"
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <button disabled={busy || !pasteText.trim()} onClick={addPastedText}>
                    {busy ? "…" : "Add"}
                  </button>
                </div>
              )}
              <div className="attach-hint">
                Enter to send · Shift+Enter for newline · Screenshot reads a screen · Paste text adds terminal output directly (no screenshot needed)
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function gpuDot(status: string): string {
  if (status === "ready") return "ready";
  if (status === "starting") return "starting";
  return "stopped";
}

function tempMsg(sessionId: number, role: MessageRow["role"], content: string): MessageRow {
  return {
    id: Math.floor(Math.random() * -1e9),
    session_id: sessionId,
    role,
    content,
    created_at: new Date().toISOString(),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
