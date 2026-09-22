import React, { useState } from 'react';
import MainScreen from './components/MainScreen';
import AlertScreen from './components/AlertScreen';
import RemindersScreen from './components/RemindersScreen';
import CallModal from './components/CallModal';

function App() {
  const [currentScreen, setCurrentScreen] = useState('main'); // main | alert | reminders
  const [showCallModal, setShowCallModal] = useState(false);

  return (
    <>
      {currentScreen === 'alert' && (
        <AlertScreen onConfirm={() => setCurrentScreen('main')} />
      )}

      {currentScreen === 'reminders' && (
        <RemindersScreen onBack={() => setCurrentScreen('main')} />
      )}

      {currentScreen === 'main' && (
        <MainScreen
          onTestAlert={() => setCurrentScreen('alert')}
          onShowReminders={() => setCurrentScreen('reminders')}
          onShowCallModal={() => setShowCallModal(true)}
        />
      )}

      {showCallModal && (
        <CallModal onClose={() => setShowCallModal(false)} />
      )}
    </>
  );
}

export default App;
