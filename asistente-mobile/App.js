import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Animated, StatusBar, Easing, Alert, FlatList, Modal } from 'react-native';
import axios from 'axios';
import Svg, { Path } from 'react-native-svg';

// Try to import notifee, gracefully fallback if not available in Expo Go
let notifee, AndroidImportance, AndroidCategory, AndroidVisibility;
try {
  notifee = require('@notifee/react-native').default;
  AndroidImportance = require('@notifee/react-native').AndroidImportance;
  AndroidCategory = require('@notifee/react-native').AndroidCategory;
  AndroidVisibility = require('@notifee/react-native').AndroidVisibility;
} catch (e) {
  notifee = null;
}

const API_URL = 'http://192.168.0.11:3000/api'; // Android emulator

// ===== HELPERS =====
const getDateString = () => {
  const now = new Date();
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${days[now.getDay()]}, ${now.getDate()} de ${months[now.getMonth()]}`;
};

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return '¡Buenos días!';
  if (hour < 19) return '¡Buenas tardes!';
  return '¡Buenas noches!';
};

const formatTime = (dateStr) => {
  const d = new Date(dateStr);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

const getIcon = (title) => {
  const t = title.toLowerCase();
  if (t.includes('pastilla') || t.includes('medicamento')) return '💊';
  if (t.includes('agua')) return '💧';
  if (t.includes('caminar') || t.includes('ejercicio')) return '🚶';
  if (t.includes('comer') || t.includes('comida')) return '🍽️';
  return '⏰';
};

// ===== MAIN APP =====
export default function App() {
  const [screen, setScreen] = useState('main'); // main | reminders
  const [micState, setMicState] = useState('idle');
  const [showCallModal, setShowCallModal] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [nextReminder, setNextReminder] = useState(null);
  const [reminders, setReminders] = useState([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnims = useRef([...Array(5)].map(() => new Animated.Value(8))).current;

  // Setup notifications
  useEffect(() => {
    if (notifee) {
      (async () => {
        await notifee.requestPermission();
        await notifee.createChannel({
          id: 'critical_alarms',
          name: 'Alarmas Críticas Médicas',
          importance: AndroidImportance?.HIGH,
          sound: 'default',
        });
      })();
    }
  }, []);

  // Fetch next reminder
  useEffect(() => {
    axios.get(`${API_URL}/reminders/next`)
      .then(res => { if (res.data) setNextReminder(res.data); })
      .catch(() => {
        setNextReminder({ id: 1, title: 'Pastilla para la presión', time: new Date().toISOString(), isCritical: true });
      });
  }, []);

  // Pulse animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // Sound wave animation
  useEffect(() => {
    if (micState === 'listening' || micState === 'speaking') {
      waveAnims.forEach((anim, i) => {
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 28, duration: 400 + i * 80, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
            Animated.timing(anim, { toValue: 8, duration: 400 + i * 80, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          ])
        ).start();
      });
    } else {
      waveAnims.forEach(a => a.setValue(8));
    }
  }, [micState]);

  const handleMicPress = () => {
    if (micState !== 'idle') {
      setMicState('idle'); 
      return; 
    }
    
    // Simulación visual en el celular (Opción Híbrida)
    setMicState('listening');
    setTimeout(() => {
      setMicState('speaking');
      setTimeout(() => {
        setMicState('idle');
      }, 2000);
    }, 4000);
  };

  const handleMarkComplete = async () => {
    if (nextReminder) {
      try { await axios.post(`${API_URL}/reminders/${nextReminder.id}/complete`); } catch (e) {}
      try {
        const res = await axios.get(`${API_URL}/reminders/next`);
        setNextReminder(res.data || null);
      } catch (e) { setNextReminder(null); }
    }
  };

  const loadReminders = async () => {
    try {
      const res = await axios.get(`${API_URL}/reminders`);
      setReminders(res.data);
    } catch (e) {
      setReminders([
        { id: 1, title: 'Pastilla para la presión', time: new Date().toISOString(), isCritical: true, isCompleted: false },
        { id: 2, title: 'Tomar agua', time: new Date().toISOString(), isCritical: false, isCompleted: false },
      ]);
    }
    setScreen('reminders');
  };

  const triggerAlert = async () => {
    if (notifee) {
      await notifee.displayNotification({
        title: '¡ALERTA MÉDICA!',
        body: nextReminder?.title || 'Es hora de tomar tu pastilla.',
        android: {
          channelId: 'critical_alarms',
          category: AndroidCategory?.ALARM,
          importance: AndroidImportance?.HIGH,
          fullScreenAction: { id: 'default' },
          pressAction: { id: 'default' },
        },
      });
    }
    setShowAlert(true);
  };

  // ===== SCREENS =====

  if (showAlert) {
    return (
      <View style={styles.alertScreen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.alertIconCircle}><Text style={{ fontSize: 48 }}>💊</Text></View>
        <Text style={styles.alertTitle}>¡Es hora de {nextReminder?.title || 'tomar tu pastilla'}!</Text>
        <Text style={styles.alertTime}>{nextReminder ? formatTime(nextReminder.time) : '8:00 PM'}</Text>
        <TouchableOpacity style={styles.alertConfirm} onPress={() => { setShowAlert(false); handleMarkComplete(); }}>
          <Text style={styles.alertConfirmText}>✅ YA LA TOMÉ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === 'reminders') {
    return (
      <View style={styles.remindersScreen}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.screenHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('main')}>
            <Text style={{ color: '#0f172a', fontSize: 20 }}>←</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Mis Recordatorios</Text>
        </View>
        <FlatList
          data={reminders}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ gap: 10, paddingBottom: 20 }}
          renderItem={({ item }) => (
            <View style={[styles.reminderItem, item.isCritical && styles.reminderItemCritical, item.isCompleted && { opacity: 0.4 }]}>
              <Text style={{ fontSize: 28, marginRight: 12 }}>{getIcon(item.title)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.reminderItemTitle}>{item.title}</Text>
                <Text style={styles.reminderItemTime}>{formatTime(item.time)}</Text>
              </View>
              <View style={[styles.badge, item.isCompleted ? styles.badgeDone : item.isCritical ? styles.badgeCritical : styles.badgePending]}>
                <Text style={[styles.badgeText, item.isCompleted ? { color: '#22c55e' } : item.isCritical ? { color: '#ef4444' } : { color: '#eab308' }]}>
                  {item.isCompleted ? 'HECHO' : item.isCritical ? 'CRÍTICO' : 'PENDIENTE'}
                </Text>
              </View>
            </View>
          )}
        />
      </View>
    );
  }

  // ===== MAIN SCREEN =====
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.dateText}>{getDateString().toUpperCase()}</Text>
        <Text style={styles.greetingText}>{getGreeting()}</Text>
      </View>

      {nextReminder && (
        <TouchableOpacity activeOpacity={0.9} onPress={triggerAlert}>
          <View style={styles.reminderCard}>
            <View style={styles.reminderLabelContainer}>
              <View style={styles.dot} />
              <Text style={styles.reminderLabel}>PRÓXIMO RECORDATORIO</Text>
            </View>
            <Text style={styles.reminderTitleText}>{nextReminder.title}</Text>
            <Text style={styles.reminderTimeText}>⏰ Hoy a las {formatTime(nextReminder.time)}</Text>
          </View>
        </TouchableOpacity>
      )}

      <View style={styles.micContainer}>
        <Text style={styles.instructionText}>
          {micState === 'listening' ? 'Escuchando en la computadora...' :
           micState === 'speaking' ? 'Procesando...' :
           'Activa el micrófono en la PC'}
        </Text>
        <TouchableOpacity activeOpacity={0.8} onPress={handleMicPress} style={styles.micButtonContainer}>
          {micState === 'idle' && <Animated.View style={[styles.glowLayer, { transform: [{ scale: pulseAnim }] }]} />}
          <View style={[styles.micButton, micState === 'listening' && styles.micButtonListening, micState === 'speaking' && styles.micButtonSpeaking]}>
            {micState === 'idle' ? (
              <>
                <Svg width={40} height={40} viewBox="0 0 24 24" fill="white">
                  <Path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <Path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </Svg>
                <Text style={styles.micButtonText}>HABLAR</Text>
              </>
            ) : (
              <>
                <View style={styles.soundWaves}>
                  {waveAnims.map((anim, i) => (
                    <Animated.View key={i} style={[styles.waveBar, { height: anim }]} />
                  ))}
                </View>
                <Text style={styles.micButtonText}>{micState === 'listening' ? 'ESCUCHANDO' : 'HABLANDO'}</Text>
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <View style={[styles.quickActions, { paddingHorizontal: 20 }]}>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger, { marginRight: 10 }]} onPress={() => setShowCallModal(true)}>
          <Text style={styles.actionIcon}>📞</Text>
          <Text style={styles.actionText}>Llamar a mi familia</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.actionBtnWarning, { marginLeft: 10 }]} onPress={loadReminders}>
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionText}>Mis recordatorios</Text>
        </TouchableOpacity>
      </View>

      {/* Call Modal */}
      <Modal visible={showCallModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>📞</Text>
            <Text style={styles.modalTitle}>Llamar a mi familia</Text>
            <Text style={styles.modalSubtitle}>Elige a quién quieres llamar:</Text>
            <TouchableOpacity style={styles.contactBtn} onPress={() => { setShowCallModal(false); Alert.alert('Llamando...', 'Conectando con Laura'); }}>
              <View style={styles.contactAvatar}><Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>L</Text></View>
              <View><Text style={styles.contactName}>Laura (Hija)</Text><Text style={styles.contactPhone}>+52 614 123 4567</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactBtn} onPress={() => { setShowCallModal(false); Alert.alert('Llamando...', 'Conectando con Carlos'); }}>
              <View style={styles.contactAvatar}><Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>C</Text></View>
              <View><Text style={styles.contactName}>Carlos (Hijo)</Text><Text style={styles.contactPhone}>+52 614 987 6543</Text></View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCallModal(false)} style={styles.modalClose}>
              <Text style={{ color: '#9494b8', fontSize: 16, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ===== STYLES (70/30/10 Color System) =====
const COLORS = {
  dominant: '#F5F0EB',     // 70% - Warm cream
  card: '#FFFFFF',
  secondary: '#2B7A78',    // 30% - Calming teal
  secondaryLight: '#3AAFA9',
  secondaryDark: '#17615F',
  accent: '#E8845C',       // 10% - Warm coral
  accentLight: '#F0A07A',
  textMain: '#2D3436',
  textSecondary: '#4A6163',
  textMuted: '#7F9A9E',
  success: '#2ECC71',
  danger: '#D63031',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.dominant, paddingTop: 0 },
  header: {
    backgroundColor: COLORS.secondary,
    paddingTop: 56,
    paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  dateText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  greetingText: { color: '#ffffff', fontSize: 34, fontWeight: '800' },
  reminderCard: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 20,
    marginHorizontal: 20,
    marginTop: 18,
    borderLeftWidth: 5,
    borderLeftColor: COLORS.accent,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  reminderLabelContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.accent, marginRight: 8 },
  reminderLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  reminderTitleText: { color: COLORS.textMain, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  reminderTimeText: { color: COLORS.accent, fontSize: 17, fontWeight: '700' },
  micContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  instructionText: { color: COLORS.textSecondary, fontSize: 17, marginBottom: 24, fontWeight: '600' },
  micButtonContainer: { alignItems: 'center', justifyContent: 'center', width: 180, height: 180 },
  glowLayer: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(232, 132, 92, 0.15)',
  },
  micButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: COLORS.accent,
    elevation: 10,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  micButtonListening: { backgroundColor: COLORS.success, borderColor: COLORS.success, shadowColor: COLORS.success },
  micButtonSpeaking: { backgroundColor: COLORS.accent, borderColor: COLORS.accent, shadowColor: COLORS.accent },
  micButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 6 },
  soundWaves: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32 },
  waveBar: { width: 5, backgroundColor: 'white', borderRadius: 4 },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 14,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 0,
    borderRadius: 20,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  actionBtnDanger: { borderLeftWidth: 3, borderLeftColor: COLORS.danger },
  actionBtnWarning: { borderLeftWidth: 3, borderLeftColor: COLORS.secondary },
  actionIcon: { fontSize: 30, marginBottom: 8 },
  actionText: { fontSize: 14, fontWeight: '700', textAlign: 'center', color: COLORS.textSecondary },
  // Alert Screen
  alertScreen: { flex: 1, backgroundColor: '#c0392b', alignItems: 'center', justifyContent: 'center', padding: 24 },
  alertIconCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  alertTitle: { fontSize: 32, color: 'white', fontWeight: '800', textAlign: 'center', marginBottom: 12, lineHeight: 40 },
  alertTime: { fontSize: 36, color: '#fcd34d', fontWeight: '800', marginBottom: 48 },
  alertConfirm: { width: '100%', maxWidth: 340, padding: 20, borderRadius: 24, backgroundColor: 'white', alignItems: 'center', elevation: 8 },
  alertConfirmText: { fontSize: 24, fontWeight: '800', color: '#b91c1c' },
  // Reminders Screen
  remindersScreen: { flex: 1, backgroundColor: COLORS.dominant, padding: 24, paddingTop: 56 },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.card,
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  screenTitle: { fontSize: 24, fontWeight: '800', color: COLORS.secondaryDark },
  reminderItem: {
    backgroundColor: COLORS.card,
    borderWidth: 0,
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  reminderItemCritical: { borderLeftWidth: 4, borderLeftColor: COLORS.danger },
  reminderItemTitle: { color: COLORS.textMain, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  reminderItemTime: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  badgeCritical: { backgroundColor: 'rgba(214, 48, 49, 0.1)' },
  badgePending: { backgroundColor: 'rgba(232, 132, 92, 0.1)' },
  badgeDone: { backgroundColor: 'rgba(46, 204, 113, 0.1)' },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  // Call Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(43, 122, 120, 0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: COLORS.card,
    borderRadius: 28,
    padding: 28,
    width: '100%',
    maxWidth: 380,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 25,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: COLORS.secondaryDark, textAlign: 'center', marginBottom: 8 },
  modalSubtitle: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', marginBottom: 24 },
  contactBtn: {
    backgroundColor: COLORS.dominant,
    borderWidth: 0,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  contactAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center' },
  contactName: { color: COLORS.textMain, fontSize: 17, fontWeight: '700' },
  contactPhone: { color: COLORS.textMuted, fontSize: 14 },
  modalClose: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 12,
    borderWidth: 2,
    borderColor: 'rgba(43, 122, 120, 0.2)',
    borderRadius: 16,
    backgroundColor: COLORS.card,
  },
});

