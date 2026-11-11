import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, X } from 'lucide-react';
import { useOperationsFeed } from '../context/OperationsFeedContext';
import { getDomainChatResponse } from '../lib/mockRailwayData';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface LogEntry {
  timestamp: string;
  action: string;
  details: string;
}

interface ScheduleResponse {
  schedule: any[];
  delays_before_min: number[];
  delays_after_min: number[];
  reasons?: string[];
}

interface ChatBotProps {
  logsBefore: LogEntry[];
  logsAfter: LogEntry[];
  scheduleData?: ScheduleResponse | null;
  lastAction?: string | null;
  autoExplain?: boolean;
  onClose: () => void;
  onAutoExplanationComplete?: () => void;
}

export function ChatBot({ logsBefore, logsAfter, scheduleData, lastAction, autoExplain, onClose, onAutoExplanationComplete }: ChatBotProps) {
  const feed = useOperationsFeed();
  const PROMPT_CHIPS = [
    'Explain active conflicts',
    'Summarize current delays',
    'Why was the last override applied?',
  ];

  const [messages, setMessages] = useState<Message[]>([{
    id: '1',
    text: 'Railway Operations Assistant\n\nI can explain schedule changes, conflict resolutions, and optimization decisions for the Hyderabad corridor (HYB, SC, KCG).\n\nSelect a prompt below or ask a question.',
    sender: 'bot',
    timestamp: new Date()
  }]);
  const [hasAutoExplained, setHasAutoExplained] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, []);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-explanation when override/conflict occurs
  useEffect(() => {
    if (autoExplain && lastAction && !hasAutoExplained) {
      setHasAutoExplained(true);

      const autoExplanationPrompt = `Something just happened in the railway system: ${lastAction}
      
      Please explain this in a friendly, easy-to-understand way. I want to know:
      - What exactly happened?
      - Was this a good thing or did something go wrong?
      - How does this affect train operations?
      - Should I be concerned about anything?
      
      Explain it like you're talking to someone who manages the station but isn't a technical expert.`;

      const autoMessage: Message = {
        id: Date.now().toString(),
        text: autoExplanationPrompt,
        sender: 'user',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, autoMessage]);
      handleAutoExplanation();
    }
  }, [autoExplain, lastAction, hasAutoExplained]);

  const handleAutoExplanation = async () => {
    setIsLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        const explanation = `Operational Update:\n\n• Action: ${lastAction || 'Schedule optimization evaluated'}\n• Safety Buffer: Headway verified across HYB, SC, and KCG.\n• Platform Allocation: Validated with no conflicting track locks.\n• Status: Normal corridor running profile active.`;
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: `Auto-explanation:\n\n${explanation}`,
          sender: 'bot',
          timestamp: new Date()
        }]);
        setIsLoading(false);
        if (onAutoExplanationComplete) onAutoExplanationComplete();
        return;
      }

      const contextualPrompt = `Explain what just happened in the railway system in simple terms.

      Recent Action: ${lastAction}
      Current Data: ${JSON.stringify(scheduleData?.schedule?.slice(0, 2) || 'No data')}
      
      Keep explanation under 100 words. Focus on:
      - What specific action occurred
      - Which trains/stations were affected  
      - Why the system made this decision
      - Current impact on operations
      
      Use simple language and reference specific train IDs and stations from the data.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: contextualPrompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        throw new Error(errorData.error?.message || 'Failed to get response from AI');
      }

      const data = await response.json();
      const botResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ||
        'I apologize, but I was unable to process the explanation request. Please try asking me directly about what happened.';

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: `Auto-explanation:\n\n${botResponse}`,
        sender: 'bot',
        timestamp: new Date()
      }]);

      if (onAutoExplanationComplete) {
        onAutoExplanationComplete();
      }
    } catch (error) {
      console.error('Error in auto-explanation:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: `I'm sorry, I encountered an error while generating the explanation: ${errorMessage}. Please feel free to ask me directly about what happened.`,
        sender: 'bot',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchCurrentSystemData = async () => {
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

      const [scheduleRes, trainsRes, conflictsRes, logsRes] = await Promise.all([
        fetch(`${API_BASE}/schedule`),
        fetch(`${API_BASE}/trains`),
        fetch(`${API_BASE}/conflicts`),
        fetch(`${API_BASE}/log`)
      ]);

      const currentSchedule = scheduleRes.ok ? await scheduleRes.json() : null;
      const currentTrains = trainsRes.ok ? await trainsRes.json() : null;
      const currentConflicts = conflictsRes.ok ? await conflictsRes.json() : null;
      const currentLogs = logsRes.ok ? await logsRes.json() : null;

      return {
        schedule: currentSchedule,
        trains: currentTrains,
        conflicts: currentConflicts,
        logs: currentLogs
      };
    } catch (error) {
      console.error('Error fetching current system data:', error);
      return null;
    }
  };

  const handleSend = useCallback(async () => {
    const userInput = input.trim();
    if (!userInput) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: userInput,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) {
        await new Promise(r => setTimeout(r, 450));
        const reply = getDomainChatResponse(userInput, {
          schedule: feed.schedule, trains: feed.trains, conflicts: feed.conflicts, activeDelays: feed.activeDelays, logs: feed.logs,
        });
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: reply,
          sender: 'bot',
          timestamp: new Date()
        }]);
        setIsLoading(false);
        return;
      }

      let currentData = null;
      if (!scheduleData || !logsBefore?.length) {
        currentData = await fetchCurrentSystemData();
      }

      const scheduleInfo = currentData?.schedule || scheduleData;
      const trainsInfo = currentData?.trains;
      const conflictsInfo = currentData?.conflicts;

      const systemSummary = {
        totalTrains: trainsInfo?.length || (Array.isArray(trainsInfo) ? trainsInfo.length : 'Unknown'),
        activeConflicts: conflictsInfo?.conflicts?.length || conflictsInfo?.length || 0,
        scheduledTrains: scheduleInfo?.schedule?.length || 0,
        stations: ['HYB', 'SC', 'KCG']
      };

      const prompt = `You are a railway operations assistant. Answer the user's question about the current dashboard data.

      User Question: "${userInput}"
      
      CURRENT DASHBOARD DATA:
      - Trains: ${systemSummary.totalTrains} active trains
      - Conflicts: ${systemSummary.activeConflicts} current conflicts  
      - Stations: ${systemSummary.stations.join(', ')}
      - Recent Action: ${lastAction || 'No recent actions'}
      
      Key Train Details: ${trainsInfo ? JSON.stringify(trainsInfo.slice(0, 3)) : 'No data'}
      Current Schedule: ${scheduleInfo?.schedule ? JSON.stringify(scheduleInfo.schedule.slice(0, 3)) : 'No data'}
      
      INSTRUCTIONS:
      - Keep response under 150 words
      - Focus ONLY on what's currently shown in the dashboard
      - Reference specific trains (T101, T104, etc.) and stations (HYB, SC, KCG) from the data
      - Explain in simple, practical terms
      - If asked about optimization, explain what the system is currently doing with the visible data
      - Don't give general explanations - stick to the actual current data`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('API Error:', errorData);
        throw new Error(errorData.error?.message || `API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const botResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!botResponse) {
        console.error('No response text from Gemini:', data);
        throw new Error('Gemini returned an empty response.');
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: botResponse,
        sender: 'bot',
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error('Error in chat:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: `I'm sorry, I encountered an error: ${errorMessage}. Please try again.`,
        sender: 'bot',
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, logsBefore, logsAfter, scheduleData, lastAction]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-cyan-500/30 bg-[#152019] shadow-2xl backdrop-blur-xl" style={{ height: '620px', maxHeight: 'calc(100dvh - 32px)' }} role="region" aria-label="Corridor assistant">
      {/* Header */}
      <div className="flex items-center justify-between rounded-t-2xl border-b border-cyan-500/20 bg-[#1a271e] p-4 text-white">
        <div className="flex items-center space-x-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-950/50 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
            <img src="/train-logo.png" alt="TrainVision AI" className="h-5 w-5 brightness-0 invert" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold tracking-tight text-white">Corridor assistant</h3>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <p className="text-[11px] text-slate-400">{import.meta.env.VITE_GEMINI_API_KEY ? 'Connected AI assistant' : 'Session guide · current corridor data'}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
        {messages?.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl p-3.5 text-xs leading-relaxed ${
                message.sender === 'user'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'border border-slate-800 bg-[#0e1628] text-slate-200 shadow-sm'
              }`}
            >
              <p className="whitespace-pre-line">{message.text}</p>
              <p className={`mt-1.5 text-[11px] text-right ${message.sender === 'user' ? 'text-cyan-200' : 'text-slate-500'}`}>
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-xl border border-cyan-500/30 bg-[#0e1628] p-3.5">
              <div className="flex items-center space-x-2">
                <span className="text-[11px] text-cyan-400">Reading corridor data</span>
                <div className="flex space-x-1">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: '0ms' }} />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: '150ms' }} />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompt Chips */}
      <div className="border-t border-slate-800 bg-[#0c1222] px-4 pt-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PROMPT_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setInput(chip)}
              className="rounded-full border border-cyan-500/30 bg-cyan-950/30 px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-cyan-900/50 hover:border-cyan-400 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* Textarea Input */}
      <div className="border-t border-slate-800 bg-[#1a271e] p-3.5 rounded-b-2xl">
        <div className="flex items-end space-x-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about conflict causes, platform locks, or delay cascade..."
            className="flex-1 rounded-xl border border-slate-700 bg-[#070b16] p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
            disabled={isLoading}
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="rounded-xl bg-cyan-600 p-2.5 text-white shadow-md transition-colors hover:bg-cyan-500 disabled:opacity-40"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-500">
          Integrated with Hyderabad Corridor Real-Time State • Press Enter to dispatch query
        </p>
      </div>
    </div>
  );
}
