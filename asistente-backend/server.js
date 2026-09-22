const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const multer = require('multer');
const sequelize = require('./models/database');
const Reminder = require('./models/Reminder');

const upload = multer({ storage: multer.memoryStorage() });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

// Función auxiliar para procesar con Gemini
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
  if (prompt) {
    contents.push({ text: prompt });
  }

  // Verificar cooldown
  const now = Date.now();
  if (now - lastGeminiCall < MIN_COOLDOWN_MS) {
    return { action: "CONVERSATION", response: "Un momento, déjame pensar..." };
  }
  lastGeminiCall = now;

  // Obtener hora local con timezone
  const localNow = new Date();
  const tzOffset = localNow.getTimezoneOffset();
  const tzHours = Math.abs(Math.floor(tzOffset / 60));
  const tzSign = tzOffset <= 0 ? '+' : '-';
  const localTimeStr = localNow.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' });

  const systemInstruction = `Eres un compañero cálido para adultos mayores solos. IMPORTANTE: Usa lenguaje neutro, NO asumas género. NO uses "amigo/amiga", "abuelito/abuelita", "cariño". En su lugar usa "qué gusto", "me alegra", "qué bueno", o tutéalo naturalmente. Responde en JSON: {"action":"CONVERSATION"|"CREATE_REMINDER"|"MARK_COMPLETED"|"GET_TIME"|"CLEAR_REMINDERS","response":"respuesta corta y cálida en español neutro","title":"..." (solo CREATE_REMINDER o MARK_COMPLETED),"time":"ISO8601 con zona horaria" (solo CREATE_REMINDER),"isCritical":bool (solo CREATE_REMINDER)}. HORA ACTUAL: ${localTimeStr} (UTC${tzSign}${tzHours}). Si dice "ya hice" o "ya tomé"->MARK_COMPLETED (incluye "title"). Si pide recordar->CREATE_REMINDER. Si pide hora->GET_TIME. Si dice "limpia/borra/elimina recordatorios"->CLEAR_REMINDERS. Si platica->CONVERSATION. Máximo 2 oraciones.`;

  let retries = 2;
  while (retries > 0) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.5,
          maxOutputTokens: 150,
        }
      });
      
      let text = response.text.trim();
      // Si la IA se confunde y no regresa un JSON sino texto plano, lo convertimos manualmente
      if (!text.startsWith('{')) {
        return { action: "CONVERSATION", response: text.replace(/`/g, '') };
      }
      
      return JSON.parse(text);
    } catch (error) {
      console.error(`Error en Gemini (intentos restantes: ${retries - 1}):`, error.message);
      if (retries === 1) {
        return { action: "CONVERSATION", response: "Me distraje un momento, ¿me lo repites por favor?" };
      }
      retries--;
      await new Promise(res => setTimeout(res, 500)); // Esperar solo medio segundo
    }
  }
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

  res.json({ response: intent.response, action: intent.action });
});

// POST: Procesar comando de voz (Audio a Gemini)
app.post('/api/voice-command-audio', upload.single('audio'), async (req, res) => {
  console.log("🎤 Audio recibido");
  if (!req.file) return res.status(400).json({ error: 'Audio no proporcionado' });

  const intent = await processWithGemini(null, req.file.buffer, req.file.mimetype || 'audio/m4a');
  await executeAction(intent);

  res.json({ response: intent.response, action: intent.action });
});

app.listen(PORT, () => {
  console.log(`Servidor de Asistente escuchando en el puerto ${PORT}`);
});
