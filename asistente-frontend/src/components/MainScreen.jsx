import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = '/api';

const MainScreen = ({ onTestAlert, onShowReminders, onShowCallModal }) => {
  const [micState, setMicState] = useState('idle'); // idle | listening | speaking
  const [nextReminder, setNextReminder] = useState(null);
  const [aiResponse, setAiResponse] = useState('');
  const [userSaid, setUserSaid] = useState('');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const secondsIntervalRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Fetch next reminder from backend
  useEffect(() => {
    axios.get(`${API_URL}/reminders/next`)
      .then(res => {
        if (res.data) setNextReminder(res.data);
      })
      .catch(() => {});
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      if (secondsIntervalRef.current) clearInterval(secondsIntervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Dynamic date
  const getDateString = () => {
    const now = new Date();
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]}`;
  };

  // Dynamic greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return '¡Buenos días!';
    if (hour < 19) return '¡Buenas tardes!';
    return '¡Buenas noches!';
  };

  // Format time for display
  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  const currentAudioRef = useRef(null);
  const lastAudioBase64Ref = useRef(null);

  // Reproducir voz MP3 con temporizador de seguridad que garantiza volver a IDLE
  const playVoiceResponse = (audioBase64, fallbackText) => {
    // Detener cualquier audio previo
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      } catch {}
    }

    if (audioBase64) {
      lastAudioBase64Ref.current = audioBase64;
      try {
        const audio = new Audio("data:audio/mp3;base64," + audioBase64);
        audio.playbackRate = 1.05; // Cadencia natural y clara
        currentAudioRef.current = audio;

        setMicState('speaking');

        audio.onended = () => {
          isProcessingRef.current = false;
          setMicState('idle');
        };
        audio.onerror = () => {
          isProcessingRef.current = false;
          setMicState('idle');
        };

        // Temporizador de seguridad calculado según el texto
        const safeTimeout = Math.max(6000, ((fallbackText || '').length * 100));
        setTimeout(() => {
          setMicState(prev => prev === 'speaking' ? 'idle' : prev);
        }, safeTimeout);

        audio.play().catch(err => {
          console.warn("Autoplay bloqueado por el celular:", err);
          isProcessingRef.current = false;
          setMicState('idle');
        });
        return;
      } catch (e) {
        console.error("Error reproduciendo audio MP3:", e);
      }
    }

    // Fallback con SpeechSynthesis
    if ('speechSynthesis' in window && fallbackText) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(fallbackText);
        utterance.lang = 'es-MX';
        utterance.rate = 1.05;
        setMicState('speaking');
        utterance.onend = () => {
          isProcessingRef.current = false;
          setMicState('idle');
        };
        utterance.onerror = () => {
          isProcessingRef.current = false;
          setMicState('idle');
        };
        window.speechSynthesis.speak(utterance);
      } catch {}
    }

    // Temporizador de seguridad
    setTimeout(() => {
      isProcessingRef.current = false;
      setMicState(prev => prev === 'speaking' ? 'idle' : prev);
    }, 5000);
  };

  // Enviar audio grabado al backend
  const sendAudioToBackend = async (audioBlob, mimeType) => {
    isProcessingRef.current = true;
    setMicState('processing');
    setAiResponse('Escuchando y pensando...');

    try {
      const formData = new FormData();
      const cleanMime = mimeType.split(';')[0];
      const ext = cleanMime.includes('mp4') ? 'mp4' : 'webm';
      formData.append('audio', audioBlob, `voice.${ext}`);

      const response = await axios.post(`${API_URL}/voice-command-audio`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000,
      });

      const data = response.data;
      if (data.userSaid) setUserSaid(data.userSaid);
      setAiResponse(data.response);

      // Reproducir voz MP3
      if (data.audioBase64) {
        playVoiceResponse(data.audioBase64, data.response);
      } else {
        setMicState('idle');
        isProcessingRef.current = false;
      }

      // Actualizar próximo recordatorio
      const nextRes = await axios.get(`${API_URL}/reminders/next`);
      setNextReminder(nextRes.data || null);
    } catch (err) {
      console.error('Error enviando audio:', err);
      setAiResponse('No pude procesar el mensaje. Intenta de nuevo.');
      isProcessingRef.current = false;
      setMicState('idle');
    }
  };

  // Iniciar grabación de audio con el micrófono
  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tu navegador no permite acceso al micrófono.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // No silenciar inicios de frase ni voces suaves
          autoGainControl: true,   // Amplificar automáticamente el volumen del micrófono
        },
      });
      streamRef.current = stream;

      let mimeType = 'audio/webm';
      if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (window.MediaRecorder && MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (secondsIntervalRef.current) clearInterval(secondsIntervalRef.current);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size > 500) {
          sendAudioToBackend(audioBlob, mimeType);
        } else {
          setAiResponse('Audio muy corto. Toca y habla con claridad.');
          setMicState('idle');
        }
      };

      recorder.start(200);
      setMicState('listening');
      setUserSaid('');
      setAiResponse('');
      setRecordingSeconds(1);

      if (secondsIntervalRef.current) clearInterval(secondsIntervalRef.current);
      secondsIntervalRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);

      // Temporizador de seguridad generoso en segundo plano (45s) sin mostrarlo al usuario
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = setTimeout(() => {
        stopRecording();
      }, 45000);
    } catch (err) {
      console.error('Error al iniciar grabación:', err);
      alert('Por favor permite el acceso al micrófono en tu navegador para hablar.');
      setMicState('idle');
    }
  };

  // Detener grabación
  const stopRecording = () => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    if (secondsIntervalRef.current) clearInterval(secondsIntervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleMicPress = () => {
    // Si está procesando, esperar
    if (micState === 'processing') {
      return;
    }

    // Si la IA está hablando, detener audio y regresar a idle
    if (micState === 'speaking') {
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      isProcessingRef.current = false;
      setMicState('idle');
      return;
    }

    // Si está grabando, detener y enviar
    if (micState === 'listening') {
      stopRecording();
      return;
    }

    // Iniciar grabación
    startRecording();
  };

  // Mic button content
  const renderMicContent = () => {
    if (micState === 'listening') {
      return (
        <>
          <div className="sound-waves">
            <div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div>
          </div>
          <span className="mic-label">ENVIAR</span>
        </>
      );
    }
    if (micState === 'processing') {
      return (
        <>
          <div className="processing-spinner"></div>
          <span className="mic-label">PENSANDO</span>
        </>
      );
    }
    if (micState === 'speaking') {
      return (
        <>
          <div className="sound-waves">
            <div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div>
          </div>
          <span className="mic-label">HABLANDO</span>
        </>
      );
    }
    return (
      <>
        <svg className="mic-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
        <span className="mic-label">HABLAR</span>
      </>
    );
  };

  return (
    <div className="app-container">
      <div className="header">
        <p className="date-text">{getDateString()}</p>
        <h1 className="greeting-text">{getGreeting()}</h1>
        <p className="header-subtitle">Hola, ¿en qué puedo ayudarte?</p>
      </div>

      {nextReminder && (
        <div className="reminder-card" onClick={onTestAlert} style={{ cursor: 'pointer' }}>
          <div className="reminder-label">
            <div className="dot"></div>
            Próximo recordatorio
          </div>
          <div className="reminder-title">{nextReminder.title}</div>
          <div className="reminder-time">
            ⏰ Hoy a las {formatTime(nextReminder.time)}
          </div>
        </div>
      )}

      <div className="mic-container">
        <p className="instruction-text">
          {micState === 'listening' ? '🎙️ Grabando tu voz... Habla ahora' :
           micState === 'processing' ? '🤔 Pensando la respuesta...' :
           micState === 'speaking' ? '🔊 El asistente está hablando...' :
           '👇 Toca el botón verde para hablar'}
        </p>

        {/* Tarjeta de visualización en vivo mientras graba */}
        {micState === 'listening' && (
          <div style={{
            background: 'rgba(46, 204, 113, 0.15)',
            border: '2px solid #2ECC71',
            borderRadius: '16px',
            padding: '1rem',
            margin: '0.5rem 1rem 1rem',
            textAlign: 'center',
            maxWidth: '340px',
            width: '90%'
          }}>
            <p style={{ margin: 0, fontSize: '1.25rem', color: '#FFFFFF', fontWeight: '800' }}>
              🔴 Grabando tu voz...
            </p>
            <span style={{ display: 'block', marginTop: '0.4rem', fontSize: '0.95rem', color: '#A9DFBF', fontWeight: '600' }}>
              Habla con calma y toca ENVIAR al terminar
            </span>
          </div>
        )}

        {/* Transcripción de lo que dijo el usuario y Respuesta de la IA */}
        {(userSaid || aiResponse) && micState !== 'listening' && (
          <div style={{
            background: 'rgba(43, 122, 120, 0.25)',
            border: '2px solid #2B7A78',
            borderRadius: '16px',
            padding: '1.1rem',
            margin: '0.5rem 1rem 1rem',
            textAlign: 'center',
            maxWidth: '340px',
            width: '90%'
          }}>
            {userSaid && (
              <p style={{ margin: '0 0 0.6rem 0', fontSize: '1.05rem', color: '#A9DFBF', fontWeight: '600' }}>
                🗣️ Tú dijiste: <span style={{ color: '#FFFFFF' }}>"{userSaid}"</span>
              </p>
            )}
            {aiResponse && (
              <div style={{ marginTop: userSaid ? '0.6rem' : 0 }}>
                <p style={{ margin: 0, fontSize: '1.2rem', color: '#DEF2F1', fontWeight: '700' }}>
                  💬 {aiResponse}
                </p>
                <button
                  type="button"
                  onClick={() => playVoiceResponse(lastAudioBase64Ref.current, aiResponse)}
                  style={{
                    marginTop: '0.8rem',
                    background: '#2B7A78',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '24px',
                    padding: '0.6rem 1.3rem',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                  }}
                >
                  🔊 Escuchar en voz alta
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mic-button-wrapper">
          <button 
            className={`mic-button ${micState}`}
            onClick={handleMicPress}
            title={micState === 'listening' ? 'Toca para enviar' : 'Toca para hablar'}
          >
            {renderMicContent()}
          </button>
        </div>

        {micState === 'listening' && (
          <p style={{ marginTop: '1rem', fontSize: '1rem', color: '#E8845C', fontWeight: 'bold' }}>
            👇 Toca el botón para enviar
          </p>
        )}
      </div>

      <div className="quick-actions" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <button className="action-btn danger" onClick={onShowCallModal}>
          <span className="action-icon">📞</span>
          <span className="action-text">Llamar a mi familia</span>
        </button>
        <button className="action-btn warning" onClick={onShowReminders}>
          <span className="action-icon">📋</span>
          <span className="action-text">Mis recordatorios</span>
        </button>
      </div>
    </div>
  );
};

export default MainScreen;
