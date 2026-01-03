
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Type, FunctionDeclaration, Modality } from '@google/genai';
import { SessionState, TranscriptionRecord, FormData } from './types';
import { createBlob, decode, decodeAudioData } from './AudioUtils';
import { api } from './api';

// Declare external aistudio helpers
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    // Fixed: Remove readonly modifier to match existing declarations of aistudio
    aistudio?: AIStudio;
  }
}

// --- Model Configuration ---
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
const PRO_EXTRACTION_MODEL = 'gemini-3-pro-preview';
const FAST_LITE_MODEL = 'gemini-flash-lite-latest';
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const SUMMARY_MODEL = 'gemini-3-flash-preview';

const updateFormFieldTool: FunctionDeclaration = {
  name: 'update_form_field',
  description: 'Update a specific field in the user form when they provide information.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      field: {
        type: Type.STRING,
        description: 'The field to update: "fullName", "dob", or "city".',
        enum: ['fullName', 'dob', 'city']
      },
      value: {
        type: Type.STRING,
        description: 'The value to set for the field.'
      }
    },
    required: ['field', 'value']
  }
};

const App: React.FC = () => {
  // --- State ---
  const [sessionState, setSessionState] = useState<SessionState>(SessionState.IDLE);
  const [transcriptions, setTranscriptions] = useState<TranscriptionRecord[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isReadingForm, setIsReadingForm] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [quickHelpText, setQuickHelpText] = useState<string>("");
  const [isGettingHelp, setIsGettingHelp] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    fullName: '',
    dob: '',
    city: ''
  });
  
  // --- Refs ---
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Data
  useEffect(() => {
    const init = async () => {
      const draft = await api.getDraft();
      if (draft) setFormData(draft);
      const history = await api.getAllSubmissions();
      setSubmissions(history);
    };
    init();
  }, []);

  // Form Completeness Check
  const isFormComplete = useMemo(() => {
    return !!(formData.fullName.trim() && formData.dob.trim() && formData.city.trim());
  }, [formData]);

  // Auto-save draft
  useEffect(() => {
    const persist = async () => {
      if (formData.fullName || formData.dob || formData.city) {
        setIsSaving(true);
        await api.saveDraft(formData);
        setIsSaving(false);
      }
    };
    const timer = setTimeout(persist, 1000);
    return () => clearTimeout(timer);
  }, [formData]);

  const systemInstruction = useMemo(() => {
    return `You are "Mukh-Lipi", a voice-first AI assistant for India.
CURRENT STATUS: Name: ${formData.fullName || 'Empty'}, DOB: ${formData.dob || 'Empty'}, City: ${formData.city || 'Empty'}.
RULES:
1. Speak polite Hindi only.
2. Ask ONE question for missing info.
3. Call 'update_form_field' tool for any data heard.
4. If everything is full, summarize all data in Hindi and ask confirmation: "Kya main ise jama kar doon?".
5. ONLY when the user confirms after the summary, say "Dhanyavaad, aapka form jama ho gaya hai." to signal the end of the session.`;
  }, [formData]);

  const stopAllAudio = () => {
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    if (sessionState === SessionState.SPEAKING) {
      setSessionState(SessionState.LISTENING);
    }
  };

  const updateField = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return;
      }
    }

    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("API key not found");
      setSessionState(SessionState.ERROR);
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    setSessionState(SessionState.EXTRACTING);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        const response = await ai.models.generateContent({
          model: PRO_EXTRACTION_MODEL,
          contents: {
            parts: [
              { inlineData: { data: base64Data, mimeType: file.type } },
              { text: "Act as an expert Indian document parser. Extract Full Name, Date of Birth (DD/MM/YYYY), and City/Village from this identity document. Respond ONLY in valid JSON format with keys: fullName, dob, city." }
            ]
          },
          config: { responseMimeType: "application/json" }
        });
        const result = JSON.parse(response.text || '{}');
        if (result.fullName) updateField('fullName', result.fullName);
        if (result.dob) updateField('dob', result.dob);
        if (result.city) updateField('city', result.city);
        setSessionState(SessionState.IDLE);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Pro Extraction Error:", err);
      setSessionState(SessionState.ERROR);
    }
  };

  const startSession = async () => {
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await window.aistudio.openSelectKey();
        return;
      }
    }

    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("API key not found");
      setSessionState(SessionState.ERROR);
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    try {
      setSessionState(SessionState.CONNECTING);
      
      if (!inputAudioCtxRef.current) inputAudioCtxRef.current = new AudioContext({ sampleRate: 16000 });
      if (!outputAudioCtxRef.current) outputAudioCtxRef.current = new AudioContext({ sampleRate: 24000 });
      
      await inputAudioCtxRef.current.resume();
      await outputAudioCtxRef.current.resume();

      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations: [updateFormFieldTool] }],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setSessionState(SessionState.LISTENING);
            const source = inputAudioCtxRef.current!.createMediaStreamSource(streamRef.current!);
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(s => {
                try {
                  s.sendRealtimeInput({ media: pcmBlob });
                } catch (err) {}
              }).catch(err => console.error(err));
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'update_form_field') {
                  const { field, value } = fc.args as { field: keyof FormData, value: string };
                  updateField(field, value);
                  sessionPromise.then(s => s.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                  }));
                }
              }
            }
            if (message.serverContent?.outputTranscription) currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            if (message.serverContent?.inputTranscription) currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            
            if (message.serverContent?.turnComplete) {
              if (currentInputTranscriptionRef.current) setTranscriptions(prev => [...prev, { role: 'user', text: currentInputTranscriptionRef.current, timestamp: Date.now() }]);
              if (currentOutputTranscriptionRef.current) {
                const text = currentOutputTranscriptionRef.current.toLowerCase();
                setTranscriptions(prev => [...prev, { role: 'assistant', text: currentOutputTranscriptionRef.current, timestamp: Date.now() }]);
                if (isFormComplete && (text.includes("dhanyavaad") || text.includes("धन्यवाद"))) {
                  setIsDone(true);
                  if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
                }
              }
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
            }

            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputAudioCtxRef.current && !isMuted) {
              setSessionState(SessionState.SPEAKING);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioCtxRef.current.currentTime);
              const buffer = await decodeAudioData(decode(audioData), outputAudioCtxRef.current, 24000, 1);
              const source = outputAudioCtxRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioCtxRef.current.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setSessionState(SessionState.LISTENING);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error("Live Error:", e);
            setSessionState(SessionState.ERROR);
            if (e.message?.includes("Requested entity was not found") && window.aistudio) {
              window.aistudio.openSelectKey();
            }
          },
          onclose: (e: CloseEvent) => setSessionState(SessionState.IDLE)
        }
      });
    } catch (err) {
      console.error("Session Connect Error:", err);
      setSessionState(SessionState.ERROR);
    }
  };

  const getQuickHelp = async () => {
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      setQuickHelpText("नमस्ते, मैं आपकी मदद के लिए यहाँ हूँ।");
      return;
    }
    const ai = new GoogleGenAI({ apiKey });
    setIsGettingHelp(true);
    try {
      const response = await ai.models.generateContent({
        model: FAST_LITE_MODEL,
        contents: "Give a 2-sentence simple Hindi guide on how to use Mukh-Lipi form assistant for an illiterate user."
      });
      setQuickHelpText(response.text || "");
    } catch (e) {
      setQuickHelpText("नमस्ते, मैं आपकी मदद के लिए यहाँ हूँ।");
    } finally {
      setIsGettingHelp(false);
    }
  };

  const readFormAloud = async () => {
    if (isReadingForm) return;
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      setIsReadingForm(false);
      return;
    }
    const ai = new GoogleGenAI({ apiKey });
    setIsReadingForm(true);
    try {
      if (outputAudioCtxRef.current) await outputAudioCtxRef.current.resume();
      const prompt = `Read this form summary clearly in Hindi: Aapka naam ${formData.fullName || 'khaali'}, janm tithi ${formData.dob || 'khaali'}, aur shahar ${formData.city || 'khaali'} hai.`;
      const response = await ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData && outputAudioCtxRef.current) {
        const buffer = await decodeAudioData(decode(audioData), outputAudioCtxRef.current, 24000, 1);
        const source = outputAudioCtxRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(outputAudioCtxRef.current.destination);
        source.onended = () => setIsReadingForm(false);
        source.start();
      } else {
        setIsReadingForm(false);
      }
    } catch (e) {
      console.error("TTS Error:", e);
      setIsReadingForm(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (!isFormComplete) return;
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("API key not found");
      return;
    }
    const ai = new GoogleGenAI({ apiKey });
    setIsSaving(true);
    let finalSummary = "";
    try {
      const summaryResp = await ai.models.generateContent({
        model: SUMMARY_MODEL,
        contents: `Summarize this form session transcription into a clean final application note: ${transcriptions.map(t => t.text).join(" ")}`
      });
      finalSummary = summaryResp?.text || "";
    } catch (e) {}

    await api.submitForm({ ...formData, summary: finalSummary });
    const history = await api.getAllSubmissions();
    setSubmissions(history);
    setFormData({ fullName: '', dob: '', city: '' });
    setTranscriptions([]);
    setIsDone(false);
    setSessionState(SessionState.IDLE);
    setIsSaving(false);
  };

  const clearAllHistory = async () => {
    await api.clearDatabase();
    setSubmissions([]);
    setIsConfirmingClear(false);
  };

  const lastAssistantMsg = transcriptions.filter(t => t.role === 'assistant').slice(-1)[0]?.text;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-['Noto_Sans_Devanagari'] overflow-hidden">
      <header className="bg-white border-b border-emerald-100 p-4 shadow-sm relative z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 p-2 rounded-lg text-white shadow-md">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
            </div>
            <h1 className="text-2xl font-bold text-emerald-800">मुख-लिपि AI</h1>
          </div>
          <div className="flex items-center gap-4">
             <button 
              onClick={() => {
                if (!isMuted) stopAllAudio();
                setIsMuted(!isMuted);
              }}
              className={`p-2 rounded-full transition-all ${isMuted ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}
             >
               {isMuted ? (
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
               ) : (
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
               )}
             </button>

             <button 
              onClick={() => { setShowHistory(!showHistory); setIsConfirmingClear(false); }}
              className="text-slate-500 hover:text-emerald-600 font-bold text-sm flex items-center gap-2 px-3 py-1 rounded-full hover:bg-slate-50 transition-all"
             >
               <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               इतिहास
             </button>
             <button 
              disabled={sessionState !== SessionState.IDLE || isDone}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2 rounded-full font-bold hover:bg-emerald-700 transition-all shadow-lg disabled:opacity-50 group overflow-hidden relative"
             >
               <span className="relative z-10 flex items-center gap-2">
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                 दस्तावेज़ स्कैन
               </span>
               <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
             </button>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full flex flex-col lg:flex-row gap-6 p-4 md:p-6 relative">
        <div className={`fixed inset-y-0 right-0 w-80 bg-white shadow-2xl z-30 transform transition-transform duration-300 border-l border-slate-100 ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-6 h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">आवेदन इतिहास</h2>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 p-2 hover:bg-slate-50 rounded-full transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2">
              {submissions.length === 0 && <p className="text-slate-400 text-center py-10 italic">कोई इतिहास नहीं</p>}
              {submissions.map((s, i) => (
                <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="font-bold text-emerald-700">{s.fullName}</p>
                  <p className="text-xs text-slate-500">{s.dob} • {s.city}</p>
                  <p className="text-[10px] text-slate-400 mt-2">{new Date(s.submittedAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t pt-4">
              {!isConfirmingClear ? (
                <button 
                  disabled={submissions.length === 0}
                  onClick={() => setIsConfirmingClear(true)} 
                  className="w-full text-xs text-red-500 font-bold border border-red-100 py-3 rounded-xl hover:bg-red-50 disabled:opacity-30"
                >
                  इतिहास मिटाएं
                </button>
              ) : (
                <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                  <p className="text-xs font-bold text-red-800 text-center mb-3">पक्का मिटाना चाहते हैं?</p>
                  <div className="flex gap-2">
                    <button onClick={clearAllHistory} className="flex-1 bg-red-600 text-white text-xs font-bold py-2 rounded-lg">हाँ</button>
                    <button onClick={() => setIsConfirmingClear(false)} className="flex-1 bg-white text-slate-600 text-xs font-bold py-2 rounded-lg border">नहीं</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <section className="flex-1 flex flex-col items-center justify-center bg-white rounded-[2.5rem] shadow-sm border border-slate-200 relative p-8">
          <div className="absolute top-6 left-6">
            {quickHelpText ? (
              <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 shadow-sm max-w-[250px] animate-in fade-in slide-in-from-left-2 relative">
                <button onClick={() => setQuickHelpText("")} className="absolute -top-2 -right-2 bg-white rounded-full shadow-sm text-xs p-1">✕</button>
                <p className="text-sm text-emerald-700 leading-relaxed font-medium">{quickHelpText}</p>
              </div>
            ) : (
              <button 
                onClick={getQuickHelp}
                className="bg-emerald-50 p-3 rounded-full text-emerald-600 hover:bg-emerald-100 transition-all border border-emerald-100 flex items-center gap-2"
              >
                <svg className={`w-5 h-5 ${isGettingHelp ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </button>
            )}
          </div>

          {sessionState === SessionState.IDLE && !isDone && (
             <div className="text-center space-y-10">
               <div className="relative inline-block">
                 <div className="absolute -inset-6 bg-emerald-500/10 rounded-full animate-pulse"></div>
                 <div className="relative w-44 h-44 bg-white rounded-full flex items-center justify-center border-4 border-emerald-50 shadow-inner">
                    <svg className="w-24 h-24 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                 </div>
               </div>
               <div className="space-y-4">
                 <h2 className="text-4xl font-extrabold text-slate-800">नमस्ते!</h2>
                 <p className="text-xl text-slate-500 max-w-sm mx-auto font-medium">बोलना शुरू करने के लिए बटन दबाएं।</p>
               </div>
               <button 
                onClick={startSession}
                className="bg-emerald-600 text-white text-3xl font-bold py-6 px-16 rounded-[2.5rem] hover:bg-emerald-700 shadow-2xl transform active:scale-95 transition-all"
               >
                 बातचीत शुरू करें
               </button>
             </div>
          )}

          {sessionState === SessionState.ERROR && (
            <div className="text-center space-y-6">
               <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
                 <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
               </div>
               <p className="text-xl font-bold text-red-800">कनेक्शन में त्रुटि हुई।</p>
               <button onClick={startSession} className="bg-emerald-600 text-white px-8 py-3 rounded-full font-bold">पुनः प्रयास करें</button>
            </div>
          )}

          {sessionState === SessionState.EXTRACTING && (
            <div className="text-center space-y-8 animate-pulse">
              <div className="w-32 h-32 bg-emerald-100 rounded-[2rem] flex items-center justify-center mx-auto text-emerald-600">
                <svg className="w-16 h-16 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              </div>
              <h3 className="text-2xl font-bold text-emerald-800">दस्तावेज़ स्कैन हो रहा है...</h3>
            </div>
          )}

          {(sessionState === SessionState.LISTENING || sessionState === SessionState.SPEAKING || sessionState === SessionState.CONNECTING) && !isDone && (
             <div className="w-full h-full flex flex-col items-center justify-center gap-12">
                <div className={`relative w-72 h-72 rounded-full flex items-center justify-center transition-all duration-700 ${
                  sessionState === SessionState.LISTENING ? 'bg-emerald-50 scale-105 shadow-[0_0_80px_rgba(16,185,129,0.2)] border-4 border-emerald-100' : 'bg-emerald-600 shadow-2xl'
                }`}>
                   {sessionState === SessionState.LISTENING ? (
                      <div className="flex items-end gap-3 h-24">
                         {[...Array(8)].map((_, i) => (
                           <div key={i} className="w-3.5 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: `${i*0.1}s`, height: `${20 + Math.random()*80}%` }}></div>
                         ))}
                      </div>
                   ) : (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-32 h-32 bg-white/20 rounded-full animate-ping"></div>
                        <button 
                          onClick={stopAllAudio}
                          className="mt-4 bg-white text-emerald-600 px-4 py-2 rounded-full font-black text-sm shadow-lg hover:bg-emerald-50 active:scale-95 transition-all flex items-center gap-2"
                        >
                          बोलना बंद करें
                        </button>
                      </div>
                   )}
                </div>
                <div className="max-w-xl w-full text-center">
                  <p className="text-3xl font-bold text-slate-800 leading-tight">
                    {lastAssistantMsg || (sessionState === SessionState.CONNECTING ? "तैयार हो रहे हैं..." : "सुन रहा हूँ...")}
                  </p>
                </div>
             </div>
          )}

          {isDone && isFormComplete && (
            <div className="text-center space-y-10 animate-in zoom-in duration-500">
              <div className="w-32 h-32 bg-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600 shadow-xl border-4 border-white">
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-4xl font-black text-slate-900">फॉर्म पूरा हो गया!</h2>
              <p className="text-slate-500 text-xl">नीचे दिए बटन से जमा करें।</p>
              <button onClick={() => { setIsDone(false); startSession(); }} className="text-slate-400 font-bold hover:text-slate-600">सुधारें (Edit)</button>
            </div>
          )}
        </section>

        <aside className="w-full lg:w-96 flex flex-col gap-6">
           <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-200 flex-1 flex flex-col relative overflow-hidden">
              <div className="flex items-center justify-between mb-10">
                 <h3 className="text-2xl font-bold text-slate-900 leading-tight">डिजिटल आवेदन</h3>
                 <button 
                  onClick={readFormAloud} 
                  disabled={isReadingForm || !formData.fullName}
                  className={`p-3 rounded-2xl transition-all ${isReadingForm ? 'bg-emerald-600 text-white animate-pulse' : 'bg-slate-50 text-emerald-600 hover:bg-emerald-50'}`}
                 >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                 </button>
              </div>

              <div className="space-y-8 flex-1">
                 <FormField label="नाम" value={formData.fullName} isActive={!formData.fullName && sessionState !== SessionState.IDLE} />
                 <FormField label="जन्म तिथि" value={formData.dob} isActive={!!formData.fullName && !formData.dob} />
                 <FormField label="शहर" value={formData.city} isActive={!!formData.dob && !formData.city} />
              </div>

              {/* SEPARATE SUBMISSION BUTTON: Only pops when complete */}
              {isFormComplete && (
                <div className="mt-8 animate-in zoom-in slide-in-from-bottom-10 duration-700">
                  <button 
                    onClick={handleFinalSubmit}
                    disabled={isSaving}
                    className="w-full bg-emerald-600 text-white py-6 rounded-[2rem] font-black text-2xl shadow-[0_20px_40px_rgba(16,185,129,0.3)] hover:bg-emerald-700 active:scale-95 transition-all flex items-center justify-center gap-3 relative overflow-hidden group"
                  >
                    <span className="relative z-10">{isSaving ? 'जमा हो रहा है...' : 'आवेदन जमा करें'}</span>
                    {!isSaving && <svg className="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>}
                    <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                  </button>
                  <p className="text-center text-[11px] text-emerald-700 font-bold mt-3 uppercase tracking-widest">Submit Application</p>
                </div>
              )}

              <div className="mt-10 p-5 bg-gradient-to-br from-emerald-50 to-white rounded-3xl border border-emerald-100">
                 <p className="text-[11px] text-emerald-700 font-bold leading-relaxed">Gemini AI द्वारा संचालित सुरक्षित आवेदन।</p>
              </div>
           </div>

           <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-2xl relative overflow-hidden">
              <div>
                 <p className="text-4xl font-black text-emerald-400 mb-1">{submissions.length}</p>
                 <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Database Record</p>
              </div>
           </div>
        </aside>
      </main>
    </div>
  );
};

const FormField: React.FC<{ label: string; value: string; isActive: boolean }> = ({ label, value, isActive }) => (
  <div className={`transition-all duration-700 relative ${isActive ? 'scale-105 z-10' : 'z-0'}`}>
    <div className={`p-6 rounded-[2rem] border-2 transition-all ${isActive ? 'border-emerald-500 bg-emerald-50 shadow-2xl ring-8 ring-emerald-50' : value ? 'border-slate-100 bg-slate-50' : 'border-dashed border-slate-200 bg-white opacity-40'}`}>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
        {value && <div className="p-1 bg-emerald-500 rounded-full shadow-sm text-white"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg></div>}
      </div>
      <p className={`text-2xl font-bold truncate ${value ? 'text-slate-900' : 'text-slate-300 italic'}`}>
        {value || 'जानकारी दें'}
      </p>
    </div>
    {isActive && (
      <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-16 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(16,185,129,0.5)]"></div>
    )}
  </div>
);

export default App;
