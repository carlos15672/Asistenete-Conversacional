import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

const RemindersScreen = ({ onBack }) => {
  const [reminders, setReminders] = useState([]);

  useEffect(() => {
    axios.get(`${API_URL}/reminders`)
      .then(res => setReminders(res.data))
      .catch(() => {});
  }, []);

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;

    const today = new Date();
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
    const prefix = isToday ? 'Hoy' : 'Mañana';
    return `${prefix} a las ${h}:${m} ${ampm}`;
  };

  const getIcon = (title) => {
    const t = title.toLowerCase();
    if (t.includes('pastilla') || t.includes('medicamento')) return '💊';
    if (t.includes('agua')) return '💧';
    if (t.includes('caminar') || t.includes('ejercicio')) return '🚶';
    if (t.includes('comer') || t.includes('comida')) return '🍽️';
    if (t.includes('doctor') || t.includes('cita')) return '🏥';
    return '⏰';
  };

  return (
    <div className="reminders-screen">
      <div className="screen-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <h2 className="screen-title">Mis Recordatorios</h2>
      </div>

      <div className="reminders-list">
        {reminders.length === 0 && (
          <p style={{ color: '#9494b8', textAlign: 'center', marginTop: '2rem', fontSize: '1.1rem' }}>
            No tienes recordatorios aún.
          </p>
        )}
        {reminders.map((r, i) => (
          <div
            key={r.id}
            className={`reminder-item ${r.isCritical ? 'critical' : ''} ${r.isCompleted ? 'completed' : ''}`}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <span className="reminder-item-icon">{getIcon(r.title)}</span>
            <div className="reminder-item-info">
              <div className="reminder-item-title">{r.title}</div>
              <div className="reminder-item-time">{formatTime(r.time)}</div>
            </div>
            {r.isCompleted ? (
              <span className="reminder-item-badge done">Hecho</span>
            ) : r.isCritical ? (
              <span className="reminder-item-badge critical">Crítico</span>
            ) : (
              <span className="reminder-item-badge pending">Pendiente</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RemindersScreen;
