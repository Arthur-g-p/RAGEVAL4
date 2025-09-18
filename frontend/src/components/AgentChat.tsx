import React, { useMemo, useState } from 'react';
import { RunData, Question } from '../types';
import { relAt as relationAt } from '../utils/relations';

// Lightweight markdown -> HTML formatter (safe subset)
function formatToHtml(input: string): string {
  try {
    // Escape HTML
    let s = input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Code blocks ```
    s = s.replace(/```([\s\S]*?)```/g, (_m, code) => {
      const esc = String(code)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<pre class="agent-pre"><code>${esc}</code></pre>`;
    });

    // Inline code
    s = s.replace(/`([^`]+)`/g, (_m, code) => `<code class="agent-code">${code}</code>`);

    // Bold and italic (simple)
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Newlines
    s = s.replace(/\n/g, '<br/>');

    return s;
  } catch {
    return input;
  }
}

export type AgentTab = 'overview' | 'metrics' | 'inspector' | 'chunks';

export interface AgentUIContext {
  activeTab: AgentTab;
  selectedRun: RunData | null;
  selectedQuestion: Question | null;
}

interface AgentChatProps {
  ui: AgentUIContext;
}

interface ChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  raw: string; // plain text content
  html: string; // formatted HTML for display
}

const uniqueId = (() => {
  // Closure counter + random suffix for uniqueness
  let c = 0;
  const rand = Math.random().toString(36).slice(2);
  return () => `m-${Date.now().toString(36)}-${(c++).toString(36)}-${rand}`;
})();

const AgentChat: React.FC<AgentChatProps> = ({ ui }) => {
const [open, setOpen] = useState<boolean>(false);
  type ChatSession = { id: string; title: string; messages: ChatMessage[]; isStreaming: boolean };
  const [sessions, setSessions] = useState<ChatSession[]>(() => [{
    id: 's-1',
    title: 'Session 1',
    isStreaming: false,
    messages: [{ id: 'm-0', role: 'system', raw: 'Agent ready. Share context or ask a question.', html: formatToHtml('Agent ready. Share context or ask a question.') }]
  }]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('s-1');
  const controllersRef = React.useRef<Map<string, AbortController>>(new Map());
  const [draft, setDraft] = useState<string>('');

  // Small, cheap observations based on current UI
  const observations = useMemo(() => {
    const out: string[] = [];
    try {
      if (!ui?.selectedRun) return out;
      const run = ui.selectedRun;

      if (ui.activeTab === 'overview') {
        const f1 = run.metrics?.overall_metrics?.f1 ?? 0;
        const prec = run.metrics?.overall_metrics?.precision ?? 0;
        const rec = run.metrics?.overall_metrics?.recall ?? 0;
        if (f1 < 0.5) out.push(`Overall F1 is ${f1.toFixed(3)} (< 0.5)`);
        if ((run.metrics?.generator_metrics?.hallucination ?? 0) > 0.25) {
          out.push(`Hallucination ~ ${(run.metrics!.generator_metrics!.hallucination * 100).toFixed(0)}%`);
        }
        out.push(`Precision ${Math.round(prec * 100)}%, Recall ${Math.round(rec * 100)}%`);
      }

      if (ui.activeTab === 'metrics') {
        const qs = Array.isArray(run.results) ? run.results : [];
        const withF1 = qs.map(q => ({ qid: q.query_id, f1: Number(q.metrics?.f1 ?? 0) }))
          .sort((a, b) => a.f1 - b.f1);
        if (withF1.length > 0) {
          const worst = withF1[0];
          const best = withF1[withF1.length - 1];
          out.push(`Worst by F1: ${worst.qid} (${worst.f1.toFixed(2)})`);
          out.push(`Best by F1: ${best.qid} (${best.f1.toFixed(2)})`);
        }
      }

      if (ui.activeTab === 'inspector' && ui.selectedQuestion) {
        const q: any = ui.selectedQuestion as any;
        // Count response-claim contradictions if answer2response present
        let respContr = 0;
        try {
          const arr = Array.isArray(q.answer2response) ? q.answer2response : [];
          for (const item of arr) {
            const rel = Array.isArray(item) ? item[0] : item;
            if (String(rel || '').toLowerCase() === 'contradiction') respContr += 1;
          }
        } catch {}
        if (respContr > 0) out.push(`Response contradictions vs GT: ${respContr}`);

        // Chunk → response contradictions via retrieved2response
        let chunkRespContr = 0;
        try {
          const r2r: any[] = Array.isArray(q.retrieved2response) ? q.retrieved2response : [];
          const chunkCount = Array.isArray(q.retrieved_context) ? q.retrieved_context.length : 0;
          const respCount = Array.isArray(q.response_claims) ? q.response_claims.length : 0;
          for (let i = 0; i < chunkCount; i++) {
            for (let j = 0; j < respCount; j++) {
              const rel = relationAt(r2r, i, j, chunkCount, respCount);
              if (String(rel || '').toLowerCase() === 'contradiction') chunkRespContr += 1;
            }
          }
        } catch {}
        if (chunkRespContr > 0) out.push(`Chunk↔Response contradictions: ${chunkRespContr}`);
      }

      if (ui.activeTab === 'chunks') {
        // Simple read of contradictions from effectiveness_analysis
        const qs = Array.isArray(ui.selectedRun.results) ? ui.selectedRun.results : [];
        let topContrDoc: string | null = null;
        let topContr = 0;
        for (const qq of qs) {
          if (!Array.isArray(qq.retrieved_context)) continue;
          for (const c of qq.retrieved_context) {
            const v = Number(c?.effectiveness_analysis?.gt_contradictions ?? 0)
              + Number(c?.effectiveness_analysis?.response_contradictions ?? 0);
            if (v > topContr) {
              topContr = v;
              topContrDoc = String(c?.doc_id ?? 'unknown');
            }
          }
        }
        if (topContr > 0 && topContrDoc) out.push(`Most contradictions at: ${topContrDoc} (${topContr})`);
      }
    } catch {}
    return out;
  }, [ui]);

  const contextSummary = useMemo(() => {
    const run = ui.selectedRun;
    const q = ui.selectedQuestion;
    try {
      const summary: any = {
        activeTab: ui.activeTab,
        run: run ? {
          collection: (run as any).collection,
          file_origin: (run as any).file_origin,
          overall: run.metrics?.overall_metrics ?? {},
        } : null,
        question: q ? {
          query_id: q.query_id,
          metrics: q.metrics ?? {},
          counts: {
            chunks: Array.isArray(q.retrieved_context) ? q.retrieved_context.length : 0,
            resp_claims: Array.isArray((q as any).response_claims) ? (q as any).response_claims.length : 0,
            gt_claims: Array.isArray((q as any).gt_answer_claims) ? (q as any).gt_answer_claims.length : 0,
          },
        } : null,
        observations,
      };
      return summary;
    } catch {
      return { activeTab: ui.activeTab, observations } as any;
    }
  }, [ui, observations]);

  const currentSession = React.useMemo(() => sessions.find(s => s.id === currentSessionId)!, [sessions, currentSessionId]);

  const updateCurrentSession = (updater: (s: ChatSession) => ChatSession) => {
    setSessions(prev => prev.map(s => s.id === currentSessionId ? updater(s) : s));
  };

  const pushAssistant = (text: string) => {
    updateCurrentSession(s => ({
      ...s,
      messages: s.messages.concat({ id: uniqueId(), role: 'assistant', raw: text, html: formatToHtml(text) })
    }));
  };
  const pushUser = (text: string) => {
    updateCurrentSession(s => ({
      ...s,
      title: s.title === `Session ${s.id.split('-')[1]}` || s.title.startsWith('Session ') && s.messages.length <= 1 ? (text.length > 32 ? text.slice(0, 32) + '…' : text) : s.title,
      messages: s.messages.concat({ id: uniqueId(), role: 'user', raw: text, html: formatToHtml(text) })
    }));
  };

  const handleSend = () => {
    const t = draft.trim();
    if (!t) return;
    if (!ui?.selectedRun) {
      pushAssistant('Please load a run first (no run handle available).');
      setDraft('');
      return;
    }
    pushUser(t);
    setDraft('');
    startStream(t).catch(() => {
      pushAssistant('Request failed.');
      updateCurrentSession(s => ({ ...s, isStreaming: false }));
    });
  };

  const handleInsertContext = () => {
    try {
      const json = JSON.stringify(contextSummary, null, 2);
      pushAssistant('Here is the current context summary:\n```json\n' + json + '\n```');
    } catch {
      pushAssistant('Unable to serialize context.');
    }
  };

  const getRunFileName = (): string => {
    try {
      const run: any = ui.selectedRun || {};
      const fo = run.file_origin || run.run_file || '';
      if (!fo) return '';
      const parts = String(fo).split(/[/\\\\]/);
      return parts[parts.length - 1] || String(fo);
    } catch {
      return '';
    }
  };

  const startStream = async (userText: string) => {
    const run = ui.selectedRun as any;
    if (!run) return;
    const controller = new AbortController();
    controllersRef.current.set(currentSessionId, controller);
    updateCurrentSession(s => ({ ...s, isStreaming: true }));

    // Build conversation history
    const history = currentSession.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.raw }));
    const payload = {
      messages: history.concat([{ role: 'user', content: userText }]),
      active_tab: ui.activeTab,
      selected_question_id: ui.activeTab === 'inspector' && ui.selectedQuestion ? ui.selectedQuestion.query_id : null,
      view_context: {},
      source: {
        collection: run.collection || '',
        run_file: getRunFileName() || '',
        derived: true
      }
    };

    // Log request payload
    try {
      console.group('AgentChat ▶ request');
      console.log('POST', 'http://localhost:8000/agent/chat/stream');
      console.log('payload', payload);
      console.log('payload (json):', JSON.stringify(payload, null, 2));
      console.groupEnd();
    } catch {}

    // Create a streaming assistant message placeholder
    const streamMsgId = uniqueId();
    updateCurrentSession(s => ({
      ...s,
      messages: s.messages.concat({ id: streamMsgId, role: 'assistant', raw: '', html: '' })
    }));

    const primaryUrl = 'http://127.0.0.1:8000/agent/chat/stream';
    const altUrl = 'http://localhost:8000/agent/chat/stream';
    let urlTried = primaryUrl;
    let res: Response | null = null;
    try {
      const doFetch = async (url: string) => fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      // First attempt
      res = await doFetch(urlTried);
      if ((!res.ok || !res.body) && (res.status === 404 || res.status === 502)) {
        // Retry with alternate host
        try { console.warn('AgentChat retrying with alternate URL'); } catch {}
        urlTried = altUrl;
        res = await doFetch(urlTried);
      }

      try {
        console.group('AgentChat ◀ response-init');
        console.log('url', urlTried);
        console.log('status', res.status, res.statusText);
        const hdrs: Record<string, string> = {};
        res.headers.forEach((v, k) => { hdrs[k] = v; });
        console.log('headers', hdrs);
        console.groupEnd();
      } catch {}

      if (!res.ok || !res.body) {
        pushAssistant(`HTTP ${res.status}: ${res.statusText}`);
        try {
          const text = await res.text();
          console.error('AgentChat error body:', text);
        } catch {}
        updateCurrentSession(s => ({ ...s, isStreaming: false }));
        controllersRef.current.delete(currentSessionId);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let done = false;
      let accumulated = '';
      console.groupCollapsed('AgentChat ◀ SSE stream');
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        const chunkText = decoder.decode(value, { stream: true });
        buffer += chunkText;
        try { console.debug('SSE raw chunk:', chunkText); } catch {}
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const eventChunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          try { console.debug('SSE event chunk:', eventChunk); } catch {}
          const lines = eventChunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data) continue;
            if (data === '[DONE]') { done = true; break; }
            let deltaText = '';
            try {
              const obj = JSON.parse(data);
              if (obj?.delta?.content) deltaText = String(obj.delta.content);
              else if (typeof obj?.content === 'string') deltaText = obj.content;
              else if (typeof obj?.message === 'string') deltaText = obj.message;
              else if (typeof obj === 'string') deltaText = obj;
              try { console.debug('SSE parsed data:', obj); } catch {}
            } catch {
              deltaText = data;
            }
            if (deltaText) {
              accumulated += deltaText;
              // append delta to streaming message
              setSessions(prev => prev.map(s => {
                if (s.id !== currentSessionId) return s;
                const msgs = s.messages.slice();
                const idxMsg = msgs.findIndex(m => m.id === streamMsgId);
                if (idxMsg >= 0) {
                  const m = msgs[idxMsg];
                  const newRaw = (m.raw || '') + deltaText;
                  msgs[idxMsg] = { ...m, raw: newRaw, html: formatToHtml(newRaw) };
                }
                return { ...s, messages: msgs };
              }));
            }
          }
        }
      }
      console.groupEnd();
      try { console.log('AgentChat full assistant message:', accumulated); } catch {}
    } catch (err: any) {
      pushAssistant('Streaming error or aborted.');
      try {
        if (err?.name === 'AbortError') {
          console.warn('AgentChat stream aborted');
        } else {
          console.error('AgentChat streaming error:', err);
        }
      } catch {}
    } finally {
      updateCurrentSession(s => ({ ...s, isStreaming: false }));
      controllersRef.current.delete(currentSessionId);
    }
  };

  const handleStop = () => {
    const ctrl = controllersRef.current.get(currentSessionId);
    if (ctrl) {
      try { ctrl.abort(); } catch {}
      controllersRef.current.delete(currentSessionId);
    }
    updateCurrentSession(s => ({ ...s, isStreaming: false }));
  };

  // Heuristics-based insights for quick guidance
  const heuristics = useMemo(() => {
    const run = ui.selectedRun;
    const result = {
      harmfulTop: [] as Array<{ doc_id: string; count: number }>,
      missedOpp: [] as Array<{ doc_id: string; count: number }>,
      overReliance: [] as Array<{ doc_id: string; count: number }>,
      duplicateGroups: [] as Array<{ size: number; sampleText: string; doc_ids: string[] }>,
      metricOutliers: {
        worstByF1: [] as Array<{ query_id: string; f1: number }>,
        worstByPrecision: [] as Array<{ query_id: string; precision: number }>,
        worstByRecall: [] as Array<{ query_id: string; recall: number }>,
        highHallucination: Number(run?.metrics?.generator_metrics?.hallucination ?? 0),
        noiseRelevant: Number(run?.metrics?.generator_metrics?.noise_sensitivity_in_relevant ?? 0),
        noiseIrrelevant: Number(run?.metrics?.generator_metrics?.noise_sensitivity_in_irrelevant ?? 0),
      },
      perQuestionFlags: {
        lengthGaps: [] as Array<{ query_id: string; diff: number; gtWords: number; respWords: number }>,
        lowUtilization: [] as Array<{ query_id: string; chunks: number; context_utilization: number }>,
      },
    };
    if (!run) return result;
    try {
      const chunkMap = new Map<string, any>();
      const dupMap = new Map<string, Set<string>>();
      for (const q of run.results || []) {
        if (!Array.isArray(q.retrieved_context)) continue;
        for (const c of q.retrieved_context) {
          const text = String(c?.text || '').trim().replace(/\s+/g, ' ');
          const key = `${c?.doc_id || 'unknown'}:::${text}`;
          if (!chunkMap.has(key)) chunkMap.set(key, c.effectiveness_analysis || {});
          if (text.length > 0) {
            if (!dupMap.has(text)) dupMap.set(text, new Set());
            dupMap.get(text)!.add(String(c?.doc_id || 'unknown'));
          }
        }
      }
      const chunks = Array.from(chunkMap.entries()).map(([key, eff]) => {
        const [doc_id] = key.split(':::');
        const e = eff || {};
        return {
          doc_id,
          gt_contradictions: Number(e.gt_contradictions) || 0,
          gt_entailments: Number(e.gt_entailments) || 0,
          gt_neutrals: Number(e.gt_neutrals) || 0,
          response_entailments: Number(e.response_entailments) || 0,
          response_contradictions: Number(e.response_contradictions) || 0,
          total_appearances: Number(e.total_appearances) || 0,
        };
      });

      result.harmfulTop = chunks
        .filter((c) => c.gt_contradictions > 0)
        .sort((a, b) => (b.gt_contradictions - a.gt_contradictions) || (b.total_appearances - a.total_appearances))
        .slice(0, 5)
        .map((c) => ({ doc_id: c.doc_id, count: c.gt_contradictions }));

      result.missedOpp = chunks
        .filter((c) => c.gt_entailments > 0 && c.response_entailments === 0)
        .sort((a, b) => b.gt_entailments - a.gt_entailments)
        .slice(0, 5)
        .map((c) => ({ doc_id: c.doc_id, count: c.gt_entailments }));

      result.overReliance = chunks
        .filter((c) => c.response_entailments > 0 && c.gt_entailments === 0 && c.gt_contradictions === 0 && c.gt_neutrals > 0)
        .sort((a, b) => b.response_entailments - a.response_entailments)
        .slice(0, 5)
        .map((c) => ({ doc_id: c.doc_id, count: c.response_entailments }));

      result.duplicateGroups = Array.from(dupMap.entries())
        .map(([text, ids]) => ({ size: ids.size, sampleText: text.slice(0, 140), doc_ids: Array.from(ids) }))
        .filter((g) => g.size > 1)
        .sort((a, b) => b.size - a.size)
        .slice(0, 3);

      const qs = Array.isArray(run.results) ? run.results : [];
      result.metricOutliers.worstByF1 = [...qs]
        .map((q) => ({ query_id: q.query_id, f1: Number(q.metrics?.f1 ?? 0) }))
        .sort((a, b) => a.f1 - b.f1)
        .slice(0, 3);
      result.metricOutliers.worstByPrecision = [...qs]
        .map((q) => ({ query_id: q.query_id, precision: Number((q as any).metrics?.precision ?? Number.POSITIVE_INFINITY) }))
        .filter((x) => Number.isFinite(x.precision))
        .sort((a, b) => a.precision - b.precision)
        .slice(0, 3);
      result.metricOutliers.worstByRecall = [...qs]
        .map((q) => ({ query_id: q.query_id, recall: Number((q as any).metrics?.recall ?? Number.POSITIVE_INFINITY) }))
        .filter((x) => Number.isFinite(x.recall))
        .sort((a, b) => a.recall - b.recall)
        .slice(0, 3);

      const lengthGaps: Array<{ query_id: string; diff: number; gtWords: number; respWords: number }> = [];
      const lowUtil: Array<{ query_id: string; chunks: number; context_utilization: number }> = [];
      for (const q of qs) {
        const gtWords = (q.gt_answer || '').split(/\s+/).filter(Boolean).length;
        const respWords = (q.response || '').split(/\s+/).filter(Boolean).length;
        const diff = gtWords > 0 ? respWords / gtWords : respWords > 0 ? Infinity : 1;
        if (diff >= 2 || diff <= 0.5) {
          lengthGaps.push({ query_id: q.query_id, diff, gtWords, respWords });
        }
        const chunksCount = Array.isArray(q.retrieved_context) ? q.retrieved_context.length : 0;
        const cu = Number((q as any).metrics?.context_utilization ?? NaN);
        if (chunksCount >= 6 && Number.isFinite(cu) && cu < 0.2) {
          lowUtil.push({ query_id: q.query_id, chunks: chunksCount, context_utilization: cu });
        }
      }
      result.perQuestionFlags.lengthGaps = lengthGaps
        .sort((a, b) => Math.abs(b.diff - 1) - Math.abs(a.diff - 1))
        .slice(0, 3);
      result.perQuestionFlags.lowUtilization = lowUtil.sort((a, b) => b.chunks - a.chunks).slice(0, 3);
    } catch {}
    return result;
  }, [ui]);

  const suggestedQuestions = useMemo(() => {
    const s: string[] = [];
    if (heuristics.harmfulTop.length > 0) s.push('Show top 5 harmful retrieval chunks (GT contradictions) and where they appear.');
    if (heuristics.missedOpp.length > 0) s.push('List missed opportunities: chunks entailing GT but not used by response.');
    if (heuristics.overReliance.length > 0) s.push('Are we over-relying on irrelevant chunks? Show chunks used by response but neutral to GT.');
    if (heuristics.duplicateGroups.length > 0) s.push('Summarize duplicate chunk groups (same text across doc_ids) with examples.');
    if (heuristics.metricOutliers.worstByF1.length > 0) s.push('Which questions are the worst by F1, precision, and recall?');
    if (heuristics.perQuestionFlags.lengthGaps.length > 0) s.push('Flag questions with large response vs GT length gaps and inspect one.');
    if (heuristics.perQuestionFlags.lowUtilization.length > 0) s.push('Find questions with many chunks but low context utilization.');
    return s;
  }, [heuristics]);

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        aria-label="Open Agent Chat"
        className="agent-fab"
        onClick={() => setOpen(true)}
        title="Open Agent"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 5.5C4 4.12 5.12 3 6.5 3h11C18.88 3 20 4.12 20 5.5v7c0 1.38-1.12 2.5-2.5 2.5H12l-4 4v-4H6.5C5.12 15 4 13.88 4 12.5v-7z" fill="#2563eb"/>
          <circle cx="8.5" cy="9" r="1" fill="white"/>
          <circle cx="12" cy="9" r="1" fill="white"/>
          <circle cx="15.5" cy="9" r="1" fill="white"/>
        </svg>
      </button>

      {open && (
        <div className="agent-window" role="dialog" aria-modal="true" aria-label="Agent Chat">
      <div className="agent-header">
            <div className="agent-title">Agent</div>
            <div className="agent-actions" style={{ gap: 6 }}>
              <label style={{ fontSize: 12, color: '#374151' }}>
                Session:
                <select
                  value={currentSessionId}
                  onChange={(e) => setCurrentSessionId(e.target.value)}
                  style={{ marginLeft: 6, padding: '2px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
                >
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
              </label>
              <button
                className="agent-btn"
                onClick={() => {
                  const n = sessions.length + 1;
                  const id = `s-${n}`;
                  setSessions(prev => prev.concat([{
                    id,
                    title: `Session ${n}`,
                    isStreaming: false,
                    messages: [{ id: uniqueId(), role: 'system', raw: 'Agent ready. Share context or ask a question.', html: formatToHtml('Agent ready. Share context or ask a question.') }]
                  }]));
                  setCurrentSessionId(id);
                }}
                title="New session"
              >New</button>
              {currentSession?.isStreaming && (
                <button className="agent-btn" onClick={handleStop} title="Stop streaming">Stop</button>
              )}
              <button className="agent-btn" onClick={handleInsertContext} title="Insert UI context snapshot (tab, run meta, selected question counts)">Context</button>
              <button className="agent-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
            </div>
          </div>
          <div className="agent-toolbar">
            <span className="agent-chip" aria-label={`Active tab ${ui.activeTab}`}>Tab: {ui.activeTab}</span>
            {ui.activeTab === 'inspector' && ui.selectedQuestion && (
              <span className="agent-chip">Q: {ui.selectedQuestion.query_id}</span>
            )}
          </div>

          <div className="agent-body">
            {/* Observations banner */}
            {observations.length > 0 && (
              <div className="agent-observations" aria-live="polite">
                <div className="agent-ob-title">Observations</div>
                <ul className="agent-ob-list">
                  {observations.map((o, i) => (
                    <li key={`ob-${i}`}>• {o}</li>
                  ))}
                </ul>
              </div>
            )}

            {suggestedQuestions.length > 0 && (
              <div className="agent-suggestions" aria-live="polite">
                <div className="agent-ob-title">Ask me:</div>
                <div className="agent-suggestion-list">
                  {suggestedQuestions.map((q, i) => (
                    <button key={`sugg-${i}`} className="agent-suggestion-btn" onClick={() => pushUser(q)}>{q}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="agent-messages">
              {currentSession?.messages.map((m) => (
                <div key={`${currentSession.id}-${m.id}`} className={`agent-msg agent-${m.role}`}>
                  <div className="agent-msg-bubble" dangerouslySetInnerHTML={{ __html: m.html }} />
                </div>
              ))}
            </div>
          </div>
          <div className="agent-footer">
            <textarea
              className="agent-input"
              placeholder="Type a message. Supports **bold**, *italic*, `code`, and ``` blocks."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              rows={2}
            />
            <button className="agent-send" onClick={handleSend}>Send</button>
          </div>
        </div>
      )}
    </>
  );
};

export default AgentChat;

