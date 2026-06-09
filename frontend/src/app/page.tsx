"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import { insforge } from "../services/insforge";
import Auth from "../components/Auth";

interface Diagnosis {
  root_cause: string;
  explanation: string;
  fix: string;
  kubectl_command: string;
  prevention: string;
  confidence: number;
}

interface InvestigationRun {
  id: string;
  namespace: string;
  status: string;
  root_cause: string; // JSON string or plain text
  confidence: number;
  timestamp: string;
}

type StepStatus = "pending" | "running" | "success" | "failed";

interface StepState {
  id: string;
  label: string;
  status: StepStatus;
}

const INITIAL_STEPS: StepState[] = [
  { id: "pods", label: "Inspecting Cluster Pods", status: "pending" },
  { id: "logs", label: "Collecting Container Logs", status: "pending" },
  { id: "events", label: "Analyzing Kubernetes Events", status: "pending" },
  { id: "deployments", label: "Checking Deployment Health", status: "pending" },
  { id: "network", label: "Verifying Services & Endpoints", status: "pending" },
  { id: "ai_reasoning", label: "Running Senior SRE AI Analysis", status: "pending" },
];

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [backendStatus, setBackendStatus] = useState<"checking" | "ready" | "offline">("checking");
  const [investigating, setInvestigating] = useState(false);
  const [steps, setSteps] = useState<StepState[]>(INITIAL_STEPS);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeDiagnosis, setActiveDiagnosis] = useState<Diagnosis | null>(null);
  const [history, setHistory] = useState<InvestigationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<InvestigationRun | null>(null);
  
  // Cluster contexts list & selected context state
  const [clusters, setClusters] = useState<{name: string, cluster: string, user: string}[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

  // Check auth on mount
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data } = await insforge.auth.getCurrentUser();
        if (data?.user) {
          setUser(data.user);
          fetchHistory();
          fetchClusters();
        }
      } catch (err) {
        console.error("Auth check failed:", err);
      } finally {
        setAuthChecking(false);
      }
    };
    checkUser();
  }, []);

  // Check backend health
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await axios.get(`${apiBaseUrl}/health`, { timeout: 3000 });
        if (response.data?.status === "healthy") {
          setBackendStatus("ready");
        } else {
          setBackendStatus("offline");
        }
      } catch (error) {
        setBackendStatus("offline");
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, [apiBaseUrl]);

  // Fetch contexts/clusters from backend when ready
  const fetchClusters = async () => {
    try {
      const response = await axios.get(`${apiBaseUrl}/clusters`);
      if (response.data?.status === "success") {
        const contexts = response.data.contexts || [];
        setClusters(contexts);
        if (response.data.current_context) {
          setSelectedCluster(response.data.current_context);
        } else if (contexts.length > 0) {
          setSelectedCluster(contexts[0].name);
        }
      }
    } catch (err) {
      console.error("Failed to fetch clusters:", err);
    }
  };

  // Fetch clusters when backend is ready & user is set
  useEffect(() => {
    if (backendStatus === "ready" && user) {
      fetchClusters();
    }
  }, [backendStatus, user]);

  // Fetch previous runs
  const fetchHistory = async () => {
    try {
      const { data, error } = await insforge.database
        .from("investigation")
        .select("*")
        .order("timestamp", { ascending: false });

      if (error) {
        console.error("Failed to fetch history:", error);
      } else if (data) {
        setHistory(data as InvestigationRun[]);
      }
    } catch (err) {
      console.error("History fetch error:", err);
    }
  };

  // Log in success callback
  const handleAuthSuccess = (authenticatedUser: any) => {
    setUser(authenticatedUser);
    fetchHistory();
    fetchClusters();
  };

  // Log out callback
  const handleSignOut = async () => {
    await insforge.auth.signOut();
    setUser(null);
    setHistory([]);
    setSelectedRun(null);
    setActiveDiagnosis(null);
    setSteps(INITIAL_STEPS);
    setLogs([]);
    setClusters([]);
    setSelectedCluster("");
    setErrorMessage(null);
  };

  // Trigger investigation
  const handleInvestigate = async (clusterName?: string) => {
    if (!user) return;

    const targetCluster = clusterName || selectedCluster;
    if (clusterName) {
      setSelectedCluster(clusterName);
    }

    setInvestigating(true);
    setActiveDiagnosis(null);
    setSelectedRun(null);
    setErrorMessage(null);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending" })));
    setLogs([`Initializing cluster troubleshooting workflow for cluster: ${targetCluster || "Default"}...`]);

    const channelName = `investigation:${user.id}`;

    try {
      // 1. Setup realtime listener
      await insforge.realtime.connect();
      const sub = await insforge.realtime.subscribe(channelName);

      if (!sub.ok) {
        console.error("WebSocket subscription failed:", sub.error);
        setLogs((prev) => [...prev, `[WebSocket Error] Failed to subscribe to real-time events.`]);
      } else {
        // Register listener for step updates
        insforge.realtime.on("process_updated", (eventData: any) => {
          const { step, status: stepStatus, updated_at } = eventData;
          
          setSteps((prev) =>
            prev.map((s) => (s.id === step ? { ...s, status: stepStatus as StepStatus } : s))
          );
          
          const time = new Date(updated_at).toLocaleTimeString();
          let statusEmoji = "🟡";
          if (stepStatus === "success") statusEmoji = "🟢";
          if (stepStatus === "failed") statusEmoji = "🔴";
          if (stepStatus === "running") statusEmoji = "🔵";
          
          const stepLabel = INITIAL_STEPS.find((s) => s.id === step)?.label || step;
          setLogs((prev) => [...prev, `[${time}] ${statusEmoji} ${stepLabel}: ${stepStatus.toUpperCase()}`]);
        });
      }

      // 2. Trigger API call
      setLogs((prev) => [...prev, `Contacting troubleshooting orchestration server (Cluster: ${targetCluster || "Default"})...`]);
      const response = await axios.post(`${apiBaseUrl}/investigate`, null, {
        params: { 
          user_id: user.id,
          context: targetCluster || undefined
        },
      });

      if (response.data?.status === "success") {
        const diag: Diagnosis = response.data.diagnosis;
        setActiveDiagnosis(diag);
        setLogs((prev) => [...prev, "🏆 Investigation complete! Senior SRE Diagnosis generated."]);
        
        // Ensure all steps show success
        setSteps((prev) => prev.map((s) => ({ ...s, status: "success" })));
        
        // Reload history
        fetchHistory();
      } else {
        const errMsg = response.data?.message || "Unknown error";
        setLogs((prev) => [...prev, `❌ Orchestration failed: ${errMsg}`]);
        
        let userFriendlyMsg = errMsg;
        if (
          errMsg.toLowerCase().includes("connection refused") || 
          errMsg.toLowerCase().includes("unable to connect") || 
          errMsg.toLowerCase().includes("forbidden") ||
          errMsg.toLowerCase().includes("refused")
        ) {
          userFriendlyMsg = `Unable to connect to Kubernetes cluster.

Please verify:
- kubeconfig path
- cluster access
- kubectl permissions`;
        }
        setErrorMessage(userFriendlyMsg);
        
        // Mark remaining steps as failed
        setSteps((prev) => prev.map((s) => s.status === "pending" || s.status === "running" ? { ...s, status: "failed" } : s));
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = err.response?.data?.message || err.message || "Could not complete the investigation";
      setLogs((prev) => [...prev, `❌ Error: ${errMsg}`]);
      
      let userFriendlyMsg = errMsg;
      if (
        errMsg.toLowerCase().includes("connection refused") || 
        errMsg.toLowerCase().includes("unable to connect") || 
        errMsg.toLowerCase().includes("forbidden") ||
        err.code === "ECONNABORTED" || 
        err.message.includes("Network Error")
      ) {
        userFriendlyMsg = `Unable to connect to Kubernetes cluster / Backend orchestrator.

Please verify:
- Backend orchestrator is online
- kubeconfig path
- cluster access
- kubectl permissions`;
      }
      setErrorMessage(userFriendlyMsg);
      
      setSteps((prev) => prev.map((s) => s.status === "pending" || s.status === "running" ? { ...s, status: "failed" } : s));
    } finally {
      setInvestigating(false);
      // Cleanup WebSocket subscription
      try {
        insforge.realtime.unsubscribe(channelName);
      } catch (e) {}
    }
  };

  const handleSelectHistoryRun = (run: InvestigationRun) => {
    setSelectedRun(run);
    setActiveDiagnosis(null);
    setErrorMessage(null);
  };

  const parseDiagnosis = (rootCauseField: string): Diagnosis | null => {
    try {
      return JSON.parse(rootCauseField) as Diagnosis;
    } catch (e) {
      return null;
    }
  };

  if (authChecking) {
    return (
      <main className="flex-1 flex flex-col justify-center items-center bg-slate-950 text-slate-100 py-16">
        <svg className="animate-spin h-10 w-10 text-indigo-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex-1 flex flex-col justify-center items-center px-4 relative overflow-hidden bg-slate-950 text-slate-100 py-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.08)_0,transparent_60%)] pointer-events-none" />
        <Auth onSuccess={handleAuthSuccess} />
      </main>
    );
  }

  // Determine current active display values (active investigation or selected history run)
  let displayedDiagnosis: Diagnosis | null = activeDiagnosis;
  let displayedHeader = "Live SRE Diagnosis";
  let displayedConfidence = activeDiagnosis?.confidence || 0;

  if (selectedRun) {
    const diag = parseDiagnosis(selectedRun.root_cause);
    if (diag) {
      displayedDiagnosis = diag;
      displayedHeader = `Historical Diagnosis - ${new Date(selectedRun.timestamp).toLocaleDateString()}`;
      displayedConfidence = selectedRun.confidence;
    } else {
      displayedDiagnosis = {
        root_cause: selectedRun.root_cause || "No details available.",
        explanation: "This run did not generate a structured JSON analysis or it has deprecated formatting.",
        fix: "Check the pod configuration or trigger a fresh investigation to get a complete fix recommendation.",
        kubectl_command: "kubectl get pods -n " + selectedRun.namespace,
        prevention: "N/A",
        confidence: selectedRun.confidence,
      };
      displayedHeader = `Historical Diagnosis - ${new Date(selectedRun.timestamp).toLocaleDateString()}`;
      displayedConfidence = selectedRun.confidence;
    }
  }

  // Check if cluster is healthy based on diagnosis
  const isClusterHealthy = displayedDiagnosis?.root_cause?.toLowerCase().includes("no obvious kubernetes resource failures") || 
                           displayedDiagnosis?.root_cause?.toLowerCase().includes("no critical kubernetes issues") ||
                           displayedDiagnosis?.root_cause?.toLowerCase().includes("healthy") ||
                           displayedDiagnosis?.root_cause?.toLowerCase().includes("no obvious resource failures");

  return (
    <main className="flex-1 flex flex-col bg-slate-950 text-slate-100 min-h-screen">
      {/* Top Navbar */}
      <nav className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
          <h1 className="font-extrabold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            K8s Troubleshooting SRE
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Status:</span>
            <div className="flex items-center gap-1.5 font-semibold">
              <span className={`h-2 w-2 rounded-full ${
                backendStatus === "ready"
                  ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                  : "bg-rose-500"
              }`} />
              <span className={backendStatus === "ready" ? "text-emerald-400" : "text-rose-400"}>
                {backendStatus === "ready" ? "Ready" : "Offline"}
              </span>
            </div>
          </div>

          <div className="h-4 w-[1px] bg-slate-800" />

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono hidden md:inline">
              {user.profile?.name || user.email}
            </span>
            <button
              onClick={handleSignOut}
              className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      {/* Main Dashboard Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 p-6 max-w-7xl mx-auto w-full">
        {/* Left Column: Diagnostics Orchestration (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Troubleshooting trigger card */}
          <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.03)_0,transparent_50%)] pointer-events-none" />
            
            <h2 className="text-xl font-bold mb-2 text-white">Troubleshoot Kubernetes Cluster</h2>
            <p className="text-sm text-slate-400 mb-6">
              Run automated checks on Pods, Logs, Events, Deployments, and Networking. Our AI SRE engine will correlate the results to isolate root causes.
            </p>

            {/* Cluster Selector Cards */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Select Cluster Context to Investigate (Triggers Automatically)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {clusters.length > 0 ? (
                  clusters.map((c) => {
                    const isSelected = c.name === selectedCluster;
                    return (
                      <button
                        key={c.name}
                        onClick={() => {
                          setSelectedCluster(c.name);
                          handleInvestigate(c.name);
                        }}
                        disabled={investigating}
                        className={`p-4 rounded-xl border text-left transition-all duration-300 ${
                          isSelected
                            ? "bg-indigo-500/10 border-indigo-500/50 shadow-[0_0_12px_rgba(99,102,241,0.15)] text-white"
                            : "bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-300"
                        } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex flex-col justify-between h-28 relative group`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={`h-2 w-2 rounded-full ${isSelected ? "bg-indigo-400 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.6)]" : "bg-slate-600"}`} />
                          <span className="text-[10px] font-mono text-slate-500 group-hover:text-slate-400 transition-colors uppercase">
                            Context
                          </span>
                        </div>
                        <div className="mt-2">
                          <h3 className="font-bold text-sm tracking-tight truncate w-full">{c.name}</h3>
                          <p className="text-[10px] text-slate-500 mt-1 truncate">Cluster: {c.cluster}</p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="col-span-2 py-6 text-center border border-slate-900 border-dashed rounded-xl text-slate-600 text-xs font-mono">
                    Loading available cluster contexts...
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => handleInvestigate()}
              disabled={backendStatus !== "ready" || investigating || !selectedCluster}
              className={`w-full py-4 rounded-xl font-bold tracking-wide transition-all duration-300 shadow-lg flex items-center justify-center gap-2.5 ${
                investigating
                  ? "bg-slate-900 text-slate-400 cursor-not-allowed border border-slate-800"
                  : (backendStatus === "ready" && selectedCluster)
                  ? "bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-600 hover:to-cyan-600 text-white hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                  : "bg-slate-900 text-slate-600 cursor-not-allowed border border-slate-800"
              }`}
            >
              {investigating ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Running Real-time Diagnostics...</span>
                </>
              ) : (
                <>
                  <span>Investigate Cluster Context</span>
                </>
              )}
            </button>
          </div>

          {/* Diagnostics Real-time Steps */}
          {(investigating || activeDiagnosis || logs.length > 0) && (
            <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6 shadow-xl space-y-6">
              <div>
                <h3 className="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">
                  Troubleshooting Progress
                </h3>
                <div className="space-y-3.5">
                  {steps.map((step) => {
                    let icon = <div className="h-2 w-2 rounded-full bg-slate-700" />;
                    let labelColor = "text-slate-400";
                    if (step.status === "running") {
                      icon = (
                        <svg className="animate-spin h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      );
                      labelColor = "text-indigo-400 font-semibold";
                    } else if (step.status === "success") {
                      icon = (
                        <svg className="h-4.5 w-4.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      );
                      labelColor = "text-slate-200";
                    } else if (step.status === "failed") {
                      icon = (
                        <svg className="h-4.5 w-4.5 text-rose-500" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      );
                      labelColor = "text-rose-400";
                    }

                    return (
                      <div key={step.id} className="flex items-center gap-3">
                        <div className="h-6 w-6 flex items-center justify-center">{icon}</div>
                        <span className={`text-sm ${labelColor}`}>{step.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Console Logs Terminal */}
              <div className="border border-slate-800 bg-slate-950/90 rounded-xl p-4 font-mono text-xs text-slate-300 space-y-1.5 max-h-48 overflow-y-auto">
                <div className="text-slate-500 pb-1 border-b border-slate-900 mb-2 flex items-center justify-between">
                  <span>ORCHESTRATOR EVENT STREAM</span>
                  {investigating && <span className="animate-pulse text-indigo-400">●</span>}
                </div>
                {logs.map((log, idx) => (
                  <div key={idx} className="flex gap-2">
                    <span className="text-indigo-500/80 select-none">&gt;</span>
                    <span>{log}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Historical List & Diagnosis (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* User friendly Error Box */}
          {errorMessage ? (
            <div className="bg-rose-950/20 border border-rose-900/40 rounded-2xl p-6 shadow-xl relative text-left">
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-rose-500/10 text-rose-400 mb-4 border border-rose-500/20">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <h3 className="text-sm font-bold text-rose-400 mb-2">Investigation Failed</h3>
              <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">{errorMessage}</p>
            </div>
          ) : displayedDiagnosis ? (
            isClusterHealthy ? (
              /* Healthy state card */
              <div className="bg-emerald-950/20 border border-emerald-900/40 rounded-2xl p-6 shadow-xl relative text-center py-8">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-400 mb-4 border border-emerald-500/20">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-emerald-400 mb-2">No critical Kubernetes issues detected.</h3>
                <p className="text-xs text-slate-400">Cluster appears healthy.</p>
                {displayedDiagnosis.explanation && (
                  <div className="mt-4 p-3 bg-slate-950/40 border border-slate-900/60 rounded-xl text-left text-[11px] text-slate-300">
                    <span className="font-semibold text-slate-400 block mb-1">Details:</span>
                    {displayedDiagnosis.explanation}
                  </div>
                )}
              </div>
            ) : (
              /* Diagnosis Card */
              <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-6 shadow-xl relative">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                  <h3 className="font-bold text-white tracking-tight text-sm">{displayedHeader}</h3>
                  <div className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded text-indigo-400 text-xs font-semibold">
                    <span>Confidence: {displayedConfidence}%</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Root Cause
                    </h4>
                    <p className="text-xs text-indigo-300 font-semibold">{displayedDiagnosis.root_cause}</p>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Detailed Explanation
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed">{displayedDiagnosis.explanation}</p>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Suggested Action Plan
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{displayedDiagnosis.fix}</p>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      kubectl Command
                    </h4>
                    <div className="flex items-center justify-between gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-200">
                      <code className="break-all">{displayedDiagnosis.kubectl_command}</code>
                    </div>
                  </div>

                  {displayedDiagnosis.prevention && displayedDiagnosis.prevention !== "N/A" && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                        Prevention Strategies
                      </h4>
                      <p className="text-xs text-slate-400 leading-relaxed">{displayedDiagnosis.prevention}</p>
                    </div>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="bg-slate-900/20 border border-slate-900/50 rounded-2xl p-8 shadow-xl text-center flex flex-col justify-center items-center h-48">
              <svg className="h-8 w-8 text-slate-600 mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <h4 className="text-sm font-semibold text-slate-400">No active diagnosis</h4>
              <p className="text-xs text-slate-600 mt-1 max-w-xs">
                Trigger a troubleshooting sweep or select a historical run from the table below.
              </p>
            </div>
          )}

          {/* Historical Runs List */}
          <div className="bg-slate-900/30 border border-slate-900 rounded-2xl p-6 shadow-xl">
            <h3 className="font-bold text-sm text-slate-400 uppercase tracking-wider mb-4">
              Previous Runs History
            </h3>

            {history.length > 0 ? (
              <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                {history.map((run) => {
                  const isActive = selectedRun?.id === run.id;
                  const date = new Date(run.timestamp).toLocaleString();
                  const diag = parseDiagnosis(run.root_cause);
                  const title = diag?.root_cause || run.root_cause || "System Diagnosis";

                  return (
                    <div
                      key={run.id}
                      onClick={() => handleSelectHistoryRun(run)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-200"
                          : "bg-slate-950/60 border-slate-800/80 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-slate-500 font-mono">{date}</span>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          run.status === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                        }`}>
                          {run.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs font-semibold truncate text-slate-200">{title}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-slate-600 text-xs font-mono">
                No past runs found in database.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
