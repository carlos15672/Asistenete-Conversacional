import React from 'react';

const CallModal = ({ onClose }) => {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-icon">📞</div>
        <h2 className="modal-title">Llamar a mi familia</h2>
        <p className="modal-subtitle">Elige a quién quieres llamar:</p>

        <div className="modal-contacts">
          <button className="contact-btn" onClick={() => alert('Llamando a Laura...')}>
            <div className="contact-avatar">L</div>
            <div className="contact-info">
              <div className="contact-name">Laura (Hija)</div>
              <div className="contact-phone">+52 614 123 4567</div>
            </div>
          </button>
          <button className="contact-btn" onClick={() => alert('Llamando a Carlos...')}>
            <div className="contact-avatar">C</div>
            <div className="contact-info">
              <div className="contact-name">Carlos (Hijo)</div>
              <div className="contact-phone">+52 614 987 6543</div>
            </div>
          </button>
        </div>

        <button className="modal-close" onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
};

export default CallModal;
