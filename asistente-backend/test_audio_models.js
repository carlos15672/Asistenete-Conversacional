const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Generar un pequeño buffer de audio simulado (WAV)
const wavHeader = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00, 0x02, 0x00, 0x10, 0x00,
  0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00
]);

async function testAudioModels() {
  const models = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
  for (const m of models) {
    try {
      const start = Date.now();
      const res = await ai.models.generateContent({
        model: m,
        contents: [
          {
            inlineData: {
              data: wavHeader.toString('base64'),
              mimeType: 'audio/wav'
            }
          },
          { text: 'Describe el audio en JSON: {"userSaid":"nada","response":"recibido"}' }
        ]
      });
      console.log('SUCCESS:', m, 'in', Date.now() - start, 'ms');
    } catch (e) {
      console.log('FAIL:', m, e.message.slice(0, 100));
    }
  }
}
testAudioModels();
