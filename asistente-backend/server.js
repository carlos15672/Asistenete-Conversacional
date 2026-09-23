const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const multer = require('multer');
const googleTTS = require('google-tts-api');
const sequelize = require('./models/database');
const Reminder = require('./models/Reminder');

const upload = multer({ storage: multer.memoryStorage() });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateTTS(text) {
  try {
    if (!text) return null;
    let cleanText = text.replace(/[*_#`]/g, '').trim();
    if (cleanText.length > 190) {
      const truncated = cleanText.slice(0, 190);
      const lastPunct = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
      if (lastPunct > 50) {
        cleanText = truncated.slice(0, lastPunct + 1);
      } else {
        const lastSpace = truncated.lastIndexOf(' ');
        cleanText = (lastSpace > 50 ? truncated.slice(0, lastSpace) : truncated) + '.';
      }
    }
    const base64 = await googleTTS.getAudioBase64(cleanText, {
      lang: 'es',
      slow: false,
      host: 'https://translate.google.com',
      timeout: 4000,
    });
    return base64;
  } catch (err) {
    console.error("TTS generation error:", err.message);
    return null;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting: mínimo 3 segundos entre peticiones a Gemini
let lastGeminiCall = 0;
const MIN_COOLDOWN_MS = 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Sync database (alter instead of force so data persists across restarts)
sequelize.sync({ alter: true }).then(async () => {
  console.log('Base de datos SQLite sincronizada.');

  // Only seed if empty
  const count = await Reminder.count();
  if (count === 0) {
    const now = new Date();
    await Reminder.bulkCreate([
      {
        title: 'Pastilla para la presión',
        time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0, 0),
        isCritical: true,
      },
      {
        title: 'Tomar agua (2 vasos)',
        time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0),
        isCritical: false,
      },
      {
        title: 'Caminar 15 minutos',
        time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0),
        isCritical: false,
      },
      {
        title: 'Pastilla para el colesterol',
        time: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0),
        isCritical: true,
      },
    ]);
    console.log('Recordatorios de prueba insertados.');
  }
});

// --- RUTAS API --- //

// GET: Obtener todos los recordatorios (activos primero, ordenados por hora)
app.get('/api/reminders', async (req, res) => {
  try {
    const reminders = await Reminder.findAll({ order: [['isCompleted', 'ASC'], ['time', 'ASC']] });
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Obtener el próximo recordatorio pendiente
app.get('/api/reminders/next', async (req, res) => {
  try {
    const reminder = await Reminder.findOne({
      where: { isCompleted: false },
      order: [['time', 'ASC']],
    });
    res.json(reminder || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Crear un recordatorio nuevo
app.post('/api/reminders', async (req, res) => {
  try {
    const { title, time, isCritical } = req.body;
    const reminder = await Reminder.create({
      title,
      time: new Date(time),
      isCritical: isCritical || false,
    });
    res.status(201).json(reminder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Completar un recordatorio
app.post('/api/reminders/:id/complete', async (req, res) => {
  try {
    const reminder = await Reminder.findByPk(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'No encontrado' });

    reminder.isCompleted = true;
    await reminder.save();
    res.json({ success: true, message: 'Recordatorio marcado como completado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Eliminar un recordatorio
app.delete('/api/reminders/:id', async (req, res) => {
  try {
    const reminder = await Reminder.findByPk(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'No encontrado' });

    await reminder.destroy();
    res.json({ success: true, message: 'Recordatorio eliminado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Función auxiliar para procesar con Gemini con timeout estricto
async function processWithGemini(prompt, audioBuffer = null, mimeType = null) {
  const contents = [];
  if (audioBuffer) {
    contents.push({
      inlineData: {
        data: audioBuffer.toString('base64'),
        mimeType: mimeType
      }
    });
  }

  // Cooldown mínimo de 300ms
  const now = Date.now();
  if (now - lastGeminiCall < 300) {
    await new Promise(r => setTimeout(r, 300));
  }
  lastGeminiCall = Date.now();

  // Obtener hora local con timezone
  const localNow = new Date();
  const tzOffset = localNow.getTimezoneOffset();
  const tzHours = Math.abs(Math.floor(tzOffset / 60));
  const tzSign = tzOffset <= 0 ? '+' : '-';
  const localTimeStr = localNow.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });

  const instructionText = `Eres un asistente de voz cálido y muy conciso para adultos mayores. Escucha el audio o lee el texto del usuario.
IMPORTANTE:
- Responde en MÁXIMO 1 o 2 oraciones breves (máximo 20 palabras). Sé cálido pero neutro, no asumas género.
- Si el audio está en silencio, solo contiene ruido de fondo o no se entiende voz clara, responde de inmediato: {"userSaid":"","action":"CONVERSATION","response":"No alcancé a escucharte bien, por favor acércate un poco más y repítemelo."}
Responde estrictamente en JSON con este formato:
{
  "userSaid": "lo que dijo el usuario",
  "action": "CONVERSATION" | "CREATE_REMINDER" | "MARK_COMPLETED" | "GET_TIME" | "CLEAR_REMINDERS",
  "response": "respuesta corta y clara",
  "title": "título corto si aplica",
  "time": "ISO8601 con zona horaria si aplica",
  "isCritical": false
}
HORA ACTUAL: ${localTimeStr} (UTC${tzSign}${tzHours}).
${prompt ? `Texto del usuario: "${prompt}"` : ''}`;

  contents.push({ text: instructionText });

  // Usar gemini-3.5-flash-lite primero (procesa audio en ~1.2s sin encolarse)
  const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
  for (const modelName of modelsToTry) {
    try {
      const t0 = Date.now();
      const response = await Promise.race([
        ai.models.generateContent({
          model: modelName,
          contents: contents,
          config: {
            responseMimeType: "application/json",
            temperature: 0.3,
            maxOutputTokens: 120,
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout de 7000ms excedido`)), 7000)
        )
      ]);

      const dt = Date.now() - t0;
      console.log(`⚡ Gemini (${modelName}) respondió en ${dt}ms`);
      
      let text = response.text.trim();
      if (!text.startsWith('{')) {
        return { action: "CONVERSATION", response: text.replace(/`/g, ''), userSaid: prompt || "Mensaje de voz" };
      }
      
      return JSON.parse(text);
    } catch (error) {
      console.error(`⚠️ Advertencia en Gemini (${modelName}):`, error.message);
    }
  }

  return { action: "CONVERSATION", response: "Te escuché un poco entrecortado, ¿me lo repites por favor?", userSaid: "" };
}

// Función auxiliar para ejecutar la acción en DB
async function executeAction(intent) {
  if (intent.action === 'CREATE_REMINDER') {
    const created = await Reminder.create({
      title: intent.title,
      time: new Date(intent.time),
      isCritical: intent.isCritical || false,
    });
    console.log(`✅ Recordatorio creado: "${intent.title}" a las ${new Date(intent.time).toLocaleTimeString('es-MX')}`);
  } else if (intent.action === 'MARK_COMPLETED') {
    let reminder = null;
    
    // Intentar buscar por título si Gemini lo proporcionó
    if (intent.title) {
      const { Op } = require('sequelize');
      reminder = await Reminder.findOne({
        where: { 
          isCompleted: false,
          title: { [Op.like]: `%${intent.title.split(' ')[0]}%` }
        },
        order: [['time', 'ASC']],
      });
    }
    
    // Si no encontró por título, marcar el más próximo
    if (!reminder) {
      reminder = await Reminder.findOne({
        where: { isCompleted: false },
        order: [['time', 'ASC']],
      });
    }
    
    if (reminder) {
      reminder.isCompleted = true;
      await reminder.save();
      console.log(`☑️ Recordatorio completado: "${reminder.title}"`);
    } else {
      console.log('⚠️ No se encontró recordatorio pendiente para marcar.');
    }
  } else if (intent.action === 'CLEAR_REMINDERS') {
    const deleted = await Reminder.destroy({ where: {} });
    console.log(`🗑️ ${deleted} recordatorios eliminados.`);
  }
}

// POST: Procesar comando de voz (Texto a Gemini)
app.post('/api/voice-command', async (req, res) => {
  const { text } = req.body;
  console.log("🎙️ Comando recibido en texto:", text);
  if (!text) return res.status(400).json({ error: 'Texto no proporcionado' });

  const intent = await processWithGemini(text);
  await executeAction(intent);

  const audioBase64 = await generateTTS(intent.response);
  res.json({
    response: intent.response,
    action: intent.action,
    userSaid: intent.userSaid || text,
    audioBase64: audioBase64
  });
});

// Función para detectar formato real de audio por magic bytes
function detectAudioMime(buffer, fallbackMime = 'audio/webm') {
  if (!buffer || buffer.length < 4) return fallbackMime;
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return 'audio/webm';
  }
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'audio/wav';
  }
  if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return 'audio/ogg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return 'audio/mp4';
  }
  if ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
      (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0)) {
    return 'audio/mp3';
  }
  if (fallbackMime && fallbackMime.startsWith('audio/')) {
    return fallbackMime.split(';')[0];
  }
  return 'audio/webm';
}

// POST: Procesar comando de voz (Audio a Gemini)
app.post('/api/voice-command-audio', upload.single('audio'), async (req, res) => {
  let audioBuffer;
  let mimeType;

  // Soportar tanto FormData como JSON con base64 para evitar bugs en React Native
  if (req.body && req.body.audioBase64) {
    audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
    mimeType = req.body.mimeType || 'audio/m4a';
  } else if (req.file) {
    audioBuffer = req.file.buffer;
    mimeType = (req.file.mimetype || 'audio/webm').split(';')[0];
  } else {
    return res.status(400).json({ error: 'Audio no proporcionado' });
  }

  mimeType = detectAudioMime(audioBuffer, mimeType);
  console.log(`🎤 Audio recibido: ${audioBuffer.length} bytes, formato: ${mimeType}`);

  // Validación de audio mínimo para evitar 400 Invalid Argument
  if (!audioBuffer || audioBuffer.length < 1500) {
    console.log("⚠️ Audio muy corto descartado.");
    const shortResp = "El audio fue muy cortito. Toca el botón, habla lo que necesitas y vuelve a tocarlo para enviar.";
    const audioBase64 = await generateTTS(shortResp);
    return res.json({
      response: shortResp,
      userSaid: "",
      action: "CONVERSATION",
      audioBase64: audioBase64
    });
  }

  const intent = await processWithGemini(null, audioBuffer, mimeType);
  await executeAction(intent);

  console.log(`🗣️ Usuario dijo: "${intent.userSaid || ''}" -> Respuesta: "${intent.response}"`);
  const audioBase64 = await generateTTS(intent.response);
  res.json({
    response: intent.response,
    action: intent.action,
    userSaid: intent.userSaid || '',
    audioBase64: audioBase64
  });
});

app.listen(PORT, () => {
  console.log(`Servidor de Asistente escuchando en el puerto ${PORT}`);
});
