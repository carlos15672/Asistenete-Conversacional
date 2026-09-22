import React from 'react';

const AlertScreen = ({ onConfirm, reminder }) => {
  const formatTime = (dateStr) => {
    if (!dateStr) return '8:00 PM';
    const d = new Date(dateStr);
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  };

  return (
    <div className="alert-screen">
      <div className="alert-icon-circle">
        <span>💊</span>
      </div>

      <h1 className="alert-title">
        ¡Es hora de {reminder?.title || 'tomar tu pastilla para la presión'}!
      </h1>

      <div className="alert-time">
        {formatTime(reminder?.time)}
      </div>

      <button className="alert-confirm" onClick={onConfirm}>
        ✅ YA LA TOMÉ
      </button>
    </div>
  );
};

export default AlertScreen;
