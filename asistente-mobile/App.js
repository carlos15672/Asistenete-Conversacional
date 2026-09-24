import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Animated, StatusBar,
  Easing, Alert, FlatList, Modal, Linking, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import axios from 'axios';

// Bypass localtunnel warning page
axios.defaults.headers.common['Bypass-Tunnel-Reminder'] = 'true';

import { useAudioRecorder, RecordingPresets, AudioModule } from 'expo-audio';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path } from 'react-native-svg';
import { getServerUrl, setServerUrl, buildApiUrl, DEFAULT_URL } from './config';

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
  const [screen, setScreen] = useState('main');
  const [micState, setMicState] = useState('idle'); // idle | listening | processing | speaking
  const [showCallModal, setShowCallModal] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [nextReminder, setNextReminder] = useState(null);
  const [reminders, setReminders] = useState([]);
  const [aiResponse, setAiResponse] = useState('');
  const [serverIp, setServerIp] = useState('');
  const [apiUrl, setApiUrl] = useState(DEFAULT_URL);
  const [isConnected, setIsConnected] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const waveAnims = useRef([...Array(5)].map(() => new Animated.Value(8))).current;

  // Audio recorder hook from expo-audio
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // ===== LOAD SERVER URL & INITIAL DATA =====
  useEffect(() => {
    (async () => {
      const url = await getServerUrl();
      setApiUrl(url);
      const match = url.match(/http:\/\/(.+):3000/);
      if (match) setServerIp(match[1]);
      fetchNextReminder(url);
      checkConnection(url);
    })();
  }, []);

  // ===== REQUEST MICROPHONE PERMISSION =====
  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (status.granted) {
        setHasPermission(true);
      } else {
        Alert.alert(
          'Permiso necesario',
          'Necesito acceso al micrófono para poder escucharte. Por favor actívalo en los ajustes de tu teléfono.',
          [{ text: 'Entendido' }]
        );
      }
    })();
  }, []);

  const checkConnection = async (url) => {
    try {
      await axios.get(`${url}/reminders/next`, { timeout: 3000 });
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    }
  };

  const fetchNextReminder = async (url) => {
    try {
      const res = await axios.get(`${url || apiUrl}/reminders/next`, { timeout: 5000 });
      setNextReminder(res.data || null);
    } catch {}
  };

  // ===== PULSE ANIMATION =====
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ===== SOUND WAVE ANIMATION =====
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

  // ===== VOICE RECORDING & AUDIO PLAYBACK =====
  const autoStopTimer = useRef(null);
  const currentSoundRef = useRef(null);

  const stopAnyVoice = async () => {
    try {
      Speech.stop();
      if (currentSoundRef.current) {
        await currentSoundRef.current.stopAsync().catch(() => {});
        await currentSoundRef.current.unloadAsync().catch(() => {});
        currentSoundRef.current = null;
      }
    } catch {}
  };

  const playVoiceResponse = async (text, audioBase64) => {
    await stopAnyVoice();

    // Forzar salida por altavoz principal y permitir sonido en modo silencioso (iOS/Android)
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false, // Evita que se escuche solo por el auricular de llamadas
        staysActiveInBackground: false,
      });
    } catch (e) {
      console.log('Error configurando AudioMode:', e);
    }

    setMicState('speaking');

    // 1. Intentar reproducir audio base64 de Google TTS (idéntico a la web)
    if (audioBase64) {
      try {
        const fileUri = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(fileUri, audioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const { sound } = await Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true, volume: 1.0 }
        );
        currentSoundRef.current = sound;

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish || status.error) {
            setMicState('idle');
            sound.unloadAsync().catch(() => {});
            currentSoundRef.current = null;
          }
        });
        return;
      } catch (audioErr) {
        console.warn('Fallo al reproducir base64, usando síntesis Speech:', audioErr);
      }
    }

    // 2. Fallback: síntesis nativa con idioma 'es' universal
    try {
      Speech.speak(text, {
        language: 'es',
        rate: 0.95,
        pitch: 1.0,
        onDone: () => setMicState('idle'),
        onError: (e) => {
          console.warn('Error en Speech.speak:', e);
          setMicState('idle');
        },
      });
    } catch (err) {
      console.error('Error total en voz:', err);
      setMicState('idle');
    }
  };

  const startRecording = async () => {
    try {
      await stopAnyVoice();
      setAiResponse('');
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
      } catch {}

      await recorder.prepareToRecordAsync();
      recorder.record();
      setMicState('listening');

      // Auto-enviar después de 6 segundos
      autoStopTimer.current = setTimeout(async () => {
        if (recorder.isRecording) {
          await stopAndSend();
        }
      }, 6000);

    } catch (err) {
      console.error('Error al iniciar grabación:', err);
      Alert.alert('Error', 'No se pudo iniciar el micrófono.');
    }
  };

  const stopAndSend = async () => {
    // Limpiar el timer si se envía antes de los 6 segundos
    if (autoStopTimer.current) {
      clearTimeout(autoStopTimer.current);
      autoStopTimer.current = null;
    }

    setMicState('processing');
    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) {
        setMicState('idle');
        return;
      }

      // Leer el archivo como base64
      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Enviar el audio al backend como JSON (Base64)
      const response = await axios.post(`${apiUrl}/voice-command-audio`, {
        audioBase64: base64Audio,
        mimeType: 'audio/m4a'
      }, {
        timeout: 15000,
      });

      const data = response.data;
      setAiResponse(data.response);

      // Hablar la respuesta en voz alta
      await playVoiceResponse(data.response, data.audioBase64);

      // Refrescar recordatorios
      fetchNextReminder(apiUrl);

    } catch (err) {
      console.error('Error al enviar audio:', err);
      const errorMsg = err.response
        ? 'Hubo un problema al procesar tu mensaje.'
        : 'No pude conectar con el servidor. Verifica que esté encendido y la IP sea correcta.';

      setAiResponse(errorMsg);
      await playVoiceResponse(errorMsg, null);
    }
  };

  const handleMicPress = async () => {
    if (!hasPermission) {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert('Permiso necesario', 'Activa el micrófono en los ajustes de tu teléfono.');
        return;
      }
      setHasPermission(true);
    }

    if (micState === 'idle') {
      // Un solo toque: empieza a grabar y se envía solo en 6 segundos
      await startRecording();
    } else if (micState === 'listening') {
      // Si toca antes de los 6 seg, enviar inmediatamente
      await stopAndSend();
    } else if (micState === 'speaking') {
      await stopAnyVoice();
      setMicState('idle');
    }
    // Si está 'processing', no hacer nada
  };

  // ===== MARK COMPLETE =====
  const handleMarkComplete = async () => {
    if (nextReminder) {
      try { await axios.post(`${apiUrl}/reminders/${nextReminder.id}/complete`); } catch {}
      fetchNextReminder(apiUrl);
    }
  };

  // ===== LOAD REMINDERS =====
  const loadReminders = async () => {
    try {
      const res = await axios.get(`${apiUrl}/reminders`, { timeout: 5000 });
      setReminders(res.data);
    } catch {
      setReminders([]);
      Alert.alert('Sin conexión', 'No se pudieron cargar los recordatorios.');
    }
    setScreen('reminders');
  };

  // ===== PHONE CALLS =====
  const makePhoneCall = (phoneNumber) => {
    setShowCallModal(false);
    const url = `tel:${phoneNumber.replace(/\s/g, '')}`;
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Alert.alert('No disponible', 'Tu dispositivo no puede realizar llamadas.');
      }
    });
  };

  // ===== SAVE SERVER SETTINGS =====
  const saveServerSettings = async () => {
    if (!serverIp.trim()) {
      Alert.alert('IP vacía', 'Por favor ingresa la IP del servidor.');
      return;
    }
    const newUrl = buildApiUrl(serverIp);
    await setServerUrl(newUrl);
    setApiUrl(newUrl);
    setShowSettings(false);
    setIsConnected(null);
    try {
      await axios.get(`${newUrl}/reminders/next`, { timeout: 3000 });
      setIsConnected(true);
      fetchNextReminder(newUrl);
      Alert.alert('✅ Conectado', `Servidor configurado en ${serverIp}`);
    } catch {
      setIsConnected(false);
      Alert.alert('❌ Sin conexión', `No se pudo conectar a ${serverIp}:3000. Verifica que el servidor esté encendido y estés en la misma red WiFi.`);
    }
  };

  // ===== SCREENS =====

  // ---------- ALERT SCREEN ----------
  if (showAlert) {
    return (
      <View style={styles.alertScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#c0392b" />
        <View style={styles.alertIconCircle}><Text style={{ fontSize: 48 }}>💊</Text></View>
        <Text style={styles.alertTitle}>¡Es hora de {nextReminder?.title || 'tomar tu pastilla'}!</Text>
        <Text style={styles.alertTime}>{nextReminder ? formatTime(nextReminder.time) : '8:00 PM'}</Text>
        <TouchableOpacity style={styles.alertConfirm} onPress={() => { setShowAlert(false); handleMarkComplete(); }}>
          <Text style={styles.alertConfirmText}>✅ YA LA TOMÉ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- REMINDERS SCREEN ----------
  if (screen === 'reminders') {
    return (
      <View style={styles.remindersScreen}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.dominant} />
        <View style={styles.screenHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setScreen('main')}>
            <Text style={{ color: '#0f172a', fontSize: 20 }}>←</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Mis Recordatorios</Text>
        </View>
        {reminders.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📋</Text>
            <Text style={{ color: COLORS.textMuted, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>
              No tienes recordatorios aún.{'\n'}Dile al asistente que te recuerde algo.
            </Text>
          </View>
        ) : (
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
        )}
      </View>
    );
  }

  // ---------- MAIN SCREEN ----------
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.secondary} />

      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateText}>{getDateString().toUpperCase()}</Text>
            <Text style={styles.greetingText}>{getGreeting()}</Text>
          </View>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => setShowSettings(true)}>
            <Text style={{ fontSize: 22 }}>⚙️</Text>
          </TouchableOpacity>
        </View>
        {isConnected !== null && (
          <View style={styles.connectionBadge}>
            <View style={[styles.connectionDot, { backgroundColor: isConnected ? '#2ECC71' : '#E74C3C' }]} />
            <Text style={styles.connectionText}>
              {isConnected ? 'Conectado al servidor' : 'Sin conexión al servidor'}
            </Text>
          </View>
        )}
      </View>

      {/* NEXT REMINDER CARD */}
      {nextReminder && (
        <TouchableOpacity activeOpacity={0.9} onPress={() => setShowAlert(true)}>
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

      {/* MIC AREA - CENTRO DE LA PANTALLA */}
      <View style={styles.micContainer}>
        <Text style={styles.instructionText}>
          {micState === 'listening' ? '🎙️ Habla ahora, te escucho...' :
           micState === 'processing' ? '⏳ Procesando...' :
           micState === 'speaking' ? '💬 Respondiendo...' :
           '👇 Toca para hablarme'}
        </Text>

        {/* Respuesta de la IA */}
        {aiResponse ? (
          <View style={styles.responseContainer}>
            <Text style={styles.responseText}>💬 {aiResponse}</Text>
          </View>
        ) : null}

        {/* BOTÓN GRANDE DEL MICRÓFONO */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleMicPress}
          style={styles.micButtonContainer}
          disabled={micState === 'processing'}
        >
          {micState === 'idle' && <Animated.View style={[styles.glowLayer, { transform: [{ scale: pulseAnim }] }]} />}
          <View style={[
            styles.micButton,
            micState === 'listening' && styles.micButtonListening,
            micState === 'processing' && styles.micButtonProcessing,
            micState === 'speaking' && styles.micButtonSpeaking,
          ]}>
            {micState === 'processing' ? (
              <>
                <ActivityIndicator size="large" color="white" />
                <Text style={styles.micButtonText}>PROCESANDO</Text>
              </>
            ) : micState === 'idle' ? (
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
                <Text style={styles.micButtonText}>
                  {micState === 'listening' ? 'ESCUCHANDO' : 'DETENER'}
                </Text>
              </>
            )}
          </View>
        </TouchableOpacity>

        {micState === 'listening' && (
          <Text style={styles.micHint}>Se envía automáticamente en unos segundos...</Text>
        )}
      </View>

      {/* QUICK ACTIONS */}
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

      {/* CALL MODAL */}
      <Modal visible={showCallModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={{ fontSize: 48, textAlign: 'center', marginBottom: 12 }}>📞</Text>
            <Text style={styles.modalTitle}>Llamar a mi familia</Text>
            <Text style={styles.modalSubtitle}>Elige a quién quieres llamar:</Text>
            <TouchableOpacity style={styles.contactBtn} onPress={() => makePhoneCall('+52 614 123 4567')}>
              <View style={styles.contactAvatar}><Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>L</Text></View>
              <View><Text style={styles.contactName}>Laura (Hija)</Text><Text style={styles.contactPhone}>+52 614 123 4567</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactBtn} onPress={() => makePhoneCall('+52 614 987 6543')}>
              <View style={styles.contactAvatar}><Text style={{ color: 'white', fontWeight: 'bold', fontSize: 18 }}>C</Text></View>
              <View><Text style={styles.contactName}>Carlos (Hijo)</Text><Text style={styles.contactPhone}>+52 614 987 6543</Text></View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowCallModal(false)} style={styles.modalClose}>
              <Text style={{ color: '#9494b8', fontSize: 16, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SETTINGS MODAL */}
      <Modal visible={showSettings} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 8 }}>⚙️</Text>
            <Text style={styles.modalTitle}>Configuración del Servidor</Text>
            <Text style={styles.modalSubtitle}>
              Ingresa la IP de la computadora donde corre el backend (deben estar en la misma red WiFi).
            </Text>
            <Text style={styles.inputLabel}>Dirección IP del servidor</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Ejemplo: 192.168.0.11"
              placeholderTextColor={COLORS.textMuted}
              value={serverIp}
              onChangeText={setServerIp}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.settingsHint}>
              💡 En la computadora abre una terminal y escribe ipconfig para ver tu IP local.
            </Text>
            <TouchableOpacity style={styles.saveBtn} onPress={saveServerSettings}>
              <Text style={styles.saveBtnText}>Guardar y Conectar</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSettings(false)} style={styles.modalClose}>
              <Text style={{ color: '#9494b8', fontSize: 16, fontWeight: '600' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ===== STYLES =====
const COLORS = {
  dominant: '#F5F0EB',
  card: '#FFFFFF',
  secondary: '#2B7A78',
  secondaryLight: '#3AAFA9',
  secondaryDark: '#17615F',
  accent: '#E8845C',
  accentLight: '#F0A07A',
  textMain: '#2D3436',
  textSecondary: '#4A6163',
  textMuted: '#7F9A9E',
  success: '#2ECC71',
  danger: '#D63031',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.dominant },

  // Header
  header: {
    backgroundColor: COLORS.secondary,
    paddingTop: 56, paddingBottom: 20, paddingHorizontal: 24,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
    shadowColor: COLORS.secondary, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25, shadowRadius: 20, elevation: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  dateText: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700', letterSpacing: 2, marginBottom: 6 },
  greetingText: { color: '#ffffff', fontSize: 34, fontWeight: '800' },
  settingsBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  connectionBadge: {
    flexDirection: 'row', alignItems: 'center', marginTop: 10,
    paddingVertical: 6, paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 20, alignSelf: 'flex-start',
  },
  connectionDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  connectionText: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },

  // Reminder Card
  reminderCard: {
    backgroundColor: COLORS.card, borderRadius: 20, padding: 20,
    marginHorizontal: 20, marginTop: 18, borderLeftWidth: 5, borderLeftColor: COLORS.accent,
    elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 14,
  },
  reminderLabelContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.accent, marginRight: 8 },
  reminderLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  reminderTitleText: { color: COLORS.textMain, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  reminderTimeText: { color: COLORS.accent, fontSize: 17, fontWeight: '700' },

  // Mic Area
  micContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  instructionText: { color: COLORS.textSecondary, fontSize: 17, marginBottom: 12, fontWeight: '600', textAlign: 'center' },
  responseContainer: {
    backgroundColor: 'rgba(43, 122, 120, 0.08)', borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 10, marginBottom: 16, maxWidth: '90%',
  },
  responseText: { color: COLORS.secondaryDark, fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
  micButtonContainer: { alignItems: 'center', justifyContent: 'center', width: 180, height: 180 },
  glowLayer: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(232, 132, 92, 0.15)',
  },
  micButton: {
    width: 140, height: 140, borderRadius: 70, backgroundColor: COLORS.secondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: COLORS.accent,
    elevation: 10, shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.35, shadowRadius: 20,
  },
  micButtonListening: { backgroundColor: COLORS.success, borderColor: COLORS.success, shadowColor: COLORS.success },
  micButtonProcessing: { backgroundColor: '#F39C12', borderColor: '#F39C12', shadowColor: '#F39C12' },
  micButtonSpeaking: { backgroundColor: COLORS.accent, borderColor: COLORS.accent, shadowColor: COLORS.accent },
  micButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 6 },
  micHint: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600', marginTop: 16, fontStyle: 'italic' },
  soundWaves: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32 },
  waveBar: { width: 5, backgroundColor: 'white', borderRadius: 4 },

  // Quick Actions
  quickActions: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 24, gap: 14,
  },
  actionBtn: {
    flex: 1, backgroundColor: COLORS.card, borderWidth: 0, borderRadius: 20,
    padding: 18, alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06, shadowRadius: 10,
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
    width: 48, height: 48, borderRadius: 14, backgroundColor: COLORS.card, borderWidth: 0,
    alignItems: 'center', justifyContent: 'center', elevation: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8,
  },
  screenTitle: { fontSize: 24, fontWeight: '800', color: COLORS.secondaryDark },
  reminderItem: {
    backgroundColor: COLORS.card, borderWidth: 0, borderRadius: 18, padding: 18,
    flexDirection: 'row', alignItems: 'center', marginBottom: 12,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8,
  },
  reminderItemCritical: { borderLeftWidth: 4, borderLeftColor: COLORS.danger },
  reminderItemTitle: { color: COLORS.textMain, fontSize: 17, fontWeight: '700', marginBottom: 4 },
  reminderItemTime: { color: COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  badgeCritical: { backgroundColor: 'rgba(214, 48, 49, 0.1)' },
  badgePending: { backgroundColor: 'rgba(232, 132, 92, 0.1)' },
  badgeDone: { backgroundColor: 'rgba(46, 204, 113, 0.1)' },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(43, 122, 120, 0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: COLORS.card, borderRadius: 28, padding: 28, width: '100%', maxWidth: 380,
    elevation: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15, shadowRadius: 25,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: COLORS.secondaryDark, textAlign: 'center', marginBottom: 8 },
  modalSubtitle: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
  contactBtn: {
    backgroundColor: COLORS.dominant, borderWidth: 0, borderRadius: 18,
    padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12,
  },
  contactAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.secondary, alignItems: 'center', justifyContent: 'center' },
  contactName: { color: COLORS.textMain, fontSize: 17, fontWeight: '700' },
  contactPhone: { color: COLORS.textMuted, fontSize: 14 },
  modalClose: {
    alignItems: 'center', paddingVertical: 16, marginTop: 12,
    borderWidth: 2, borderColor: 'rgba(43, 122, 120, 0.2)', borderRadius: 16, backgroundColor: COLORS.card,
  },

  // Settings
  inputLabel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  textInput: {
    backgroundColor: COLORS.dominant, borderRadius: 16, padding: 16, fontSize: 18,
    fontWeight: '700', color: COLORS.textMain, borderWidth: 2,
    borderColor: 'rgba(43, 122, 120, 0.15)', marginBottom: 12, textAlign: 'center', letterSpacing: 1,
  },
  settingsHint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  saveBtn: {
    backgroundColor: COLORS.secondary, borderRadius: 16, padding: 16,
    alignItems: 'center', marginBottom: 8, elevation: 4,
  },
  saveBtnText: { color: 'white', fontSize: 17, fontWeight: '800' },
});
