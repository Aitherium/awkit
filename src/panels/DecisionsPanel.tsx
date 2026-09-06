/**
 * Decision Cards Panel
 *
 * Displays pending decision cards that agents have raised, allowing the
 * workspace owner to review and approve/reject them.
 */

import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react";

interface DecisionOption {
  key: string;
  label: string;
  consequence: string;
}

interface Decision {
  id: string;
  headline: string;
  context: string;
  options: DecisionOption[];
  default: string;
  status: "open" | "answered" | "expired" | "cancelled";
  created_at: string;
  expires_at?: string;
  answer?: string;
  answer_note?: string;
  answered_by?: string;
  answered_at?: string;
  session_id?: string;
  raising_agent?: string;
}

export const DecisionsPanel: React.FC = () => {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [answerText, setAnswerText] = useState("");

  useEffect(() => {
    fetchDecisions();
    const interval = setInterval(fetchDecisions, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchDecisions = async () => {
    try {
      const response = await fetch("/api/v1/decisions?status=open&limit=50");
      if (!response.ok) throw new Error(response.statusText);
      const data = await response.json();
      setDecisions(data.decisions || []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load decisions"
      );
      setDecisions([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = async (
    decisionId: string,
    choice: string,
    note: string
  ) => {
    setAnswering(true);
    try {
      const response = await fetch(`/api/v1/decisions/${decisionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, note, via: "portal" }),
      });
      if (!response.ok) throw new Error(response.statusText);
      setSelectedId(null);
      setAnswerText("");
      await fetchDecisions();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to answer decision"
      );
    } finally {
      setAnswering(false);
    }
  };

  const handleCancel = async (decisionId: string) => {
    try {
      const response = await fetch(`/api/v1/decisions/${decisionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Cancelled via portal" }),
      });
      if (!response.ok) throw new Error(response.statusText);
      setSelectedId(null);
      await fetchDecisions();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel decision"
      );
    }
  };

  if (loading)
    return (
      <div className="p-8 text-center text-gray-400">
        <p>Loading decisions...</p>
      </div>
    );

  if (error)
    return (
      <div className="p-8 bg-red-500/10 border border-red-500/20 rounded">
        <p className="text-red-400">{error}</p>
      </div>
    );

  const selected = decisions.find((d) => d.id === selectedId);

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-gray-900 to-gray-950">
      {/* Header */}
      <div className="border-b border-gray-700 p-4">
        <h1 className="text-xl font-semibold text-white flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-amber-400" />
          Pending Decisions
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          {decisions.length} decision{decisions.length !== 1 ? "s" : ""} waiting
          for approval
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* List */}
        <div className="w-1/3 border-r border-gray-700 overflow-y-auto">
          {decisions.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No pending decisions</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-700">
              {decisions.map((d) => (
                <li
                  key={d.id}
                  className={`p-4 cursor-pointer transition ${
                    selectedId === d.id
                      ? "bg-amber-500/20 border-l-2 border-amber-400"
                      : "hover:bg-gray-800"
                  }`}
                  onClick={() => setSelectedId(d.id)}
                >
                  <p className="font-semibold text-white text-sm truncate">
                    {d.headline}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {d.raising_agent || "unknown"} • {d.session_id}
                  </p>
                  {d.expires_at && (
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Expires {new Date(d.expires_at).toLocaleTimeString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="w-2/3 overflow-y-auto p-6">
          {selected ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {selected.headline}
                </h2>
                <p className="text-sm text-gray-400">
                  Raised by {selected.raising_agent || "unknown"} in session{" "}
                  {selected.session_id}
                </p>
                {selected.created_at && (
                  <p className="text-xs text-gray-500 mt-1">
                    {new Date(selected.created_at).toLocaleString()}
                  </p>
                )}
              </div>

              {selected.context && (
                <div className="bg-gray-800 p-4 rounded border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
                    Context
                  </h3>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">
                    {selected.context}
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300">
                  Options
                </h3>
                {selected.options.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() =>
                      handleAnswer(selected.id, opt.key, answerText)
                    }
                    disabled={answering}
                    className={`w-full p-3 rounded border transition text-left ${
                      opt.key === selected.default
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-600 bg-gray-800 hover:bg-gray-700"
                    }`}
                  >
                    <p className="font-semibold text-white text-sm">
                      {opt.label}
                      {opt.key === selected.default && (
                        <span className="text-xs text-blue-400 ml-2">(default)</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {opt.consequence}
                    </p>
                  </button>
                ))}
              </div>

              <div className="pt-4">
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Add optional note..."
                  className="w-full p-3 bg-gray-800 border border-gray-600 rounded text-white text-sm placeholder-gray-500"
                  rows={3}
                  disabled={answering}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleCancel(selected.id)}
                  disabled={answering}
                  className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-semibold transition"
                >
                  <XCircle className="w-4 h-4 inline mr-2" />
                  Cancel Decision
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p>Select a decision to review</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DecisionsPanel;
