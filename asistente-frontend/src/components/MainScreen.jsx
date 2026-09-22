import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

const MainScreen = ({ onTestAlert, onShowReminders, onShowCallModal }) => {
  const [micState, setMicState] = useState('idle'); // idle | listening | speaking
  const [nextReminder, setNextReminder] = useState(null);
  const [isAutoListen, setIsAutoListen] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  
  const recognitionRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Fetch next reminder from backend
  useEffect(() => {
    axios.get(`${API_URL}/reminders/next`)
      .then(res => {
        if (res.data) setNextReminder(res.data);
      })
      .catch(() => {});
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

  // Setup SpeechRecognition once
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'es-MX';
      recognitionRef.current.continuous = true;       // No se detiene al primer silencio
      recognitionRef.current.interimResults = true;    // Muestra resultados parciales
      recognitionRef.current.maxAlternatives = 1;

      recognitionRef.current.onstart = () => {
        setMicState('listening');
      };

      recognitionRef.current.onresult = async (event) => {
        // Buscar el resultado final más reciente
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript = event.results[i][0].transcript;
          } else {
            interimTranscript = event.results[i][0].transcript;
          }
        }

        // Mostrar texto parcial mientras habla
        if (interimTranscript && !finalTranscript) {
          setLastTranscript(interimTranscript + '...');
          return; // Esperar a que termine de hablar
        }

        if (!finalTranscript || isProcessingRef.current) return;
        isProcessingRef.current = true;

        setLastTranscript(finalTranscript);
        recognitionRef.current.stop();
        setMicState('speaking');

        try {
          const response = await axios.post(`${API_URL}/voice-command`, { text: finalTranscript });
          const data = response.data;
          setAiResponse(data.response);
          
          const utterance = new SpeechSynthesisUtterance(data.response);
          utterance.lang = 'es-MX';
          utterance.rate = 1.05; // Ligeramente más rápido para que no sea tedioso
          utterance.onend = () => {
            isProcessingRef.current = false;
            setMicState('idle');
          };
          window.speechSynthesis.speak(utterance);
          
          const nextRes = await axios.get(`${API_URL}/reminders/next`);
          setNextReminder(nextRes.data || null);
        } catch (err) {
          console.error(err);
          isProcessingRef.current = false;
          setMicState('idle');
        }
      };

      recognitionRef.current.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.error('Speech error:', event.error);
        }
        isProcessingRef.current = false;
        setMicState('idle');
      };

      recognitionRef.current.onend = () => {
        if (!isProcessingRef.current) {
          setMicState((prev) => prev === 'listening' ? 'idle' : prev);
        }
      };
    }
  }, []);

  // Auto-restart listening if it goes idle and autoListen is true
  useEffect(() => {
    if (isAutoListen && micState === 'idle' && recognitionRef.current && !isProcessingRef.current) {
      const timer = setTimeout(() => {
        try {
          recognitionRef.current.start();
        } catch (e) {
          // Ignore if already started
        }
      }, 800); // Pequeño delay para que no choque con el cierre anterior
      return () => clearTimeout(timer);
    }
  }, [micState, isAutoListen]);

  const handleMicPress = () => {
    if (!recognitionRef.current) {
      alert("El reconocimiento de voz no está soportado en este navegador.");
      return;
    }
    
    // Si está hablando la IA, cancelar la voz
    if (micState === 'speaking') {
      window.speechSynthesis.cancel();
      isProcessingRef.current = false;
      setMicState('idle');
      return;
    }
    
    if (isAutoListen) {
      setIsAutoListen(false);
      recognitionRef.current.stop();
      setMicState('idle');
    } else {
      setIsAutoListen(true);
    }
  };

  // Mic button content
  const renderMicContent = () => {
    if (micState === 'listening') {
      return (
        <>
          <div className="sound-waves">
            <div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div><div className="bar"></div>
          </div>
          <span className="mic-label">ESCUCHANDO</span>
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
          {micState === 'listening' ? '🎙️ Te estoy escuchando...' :
           micState === 'speaking' ? '💬 Procesando tu mensaje...' :
           '👇 Toca el botón para hablar'}
        </p>
        
        {/* Mostrar lo que captó el micrófono */}
        {lastTranscript && (
          <p style={{ 
            fontSize: '0.85rem', color: '#7F9A9E', textAlign: 'center', 
            marginBottom: '0.8rem', fontStyle: 'italic', maxWidth: '300px'
          }}>
            🎙️ "{lastTranscript}"
          </p>
        )}
        {aiResponse && micState === 'speaking' && (
          <p style={{ 
            fontSize: '0.85rem', color: '#2B7A78', textAlign: 'center', 
            marginBottom: '0.8rem', fontWeight: '600', maxWidth: '300px'
          }}>
            💬 {aiResponse}
          </p>
        )}
        
        <div className="mic-button-wrapper">
          <button 
            className={`mic-button ${micState}`}
            onClick={handleMicPress}
          >
            {renderMicContent()}
          </button>
        </div>
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
