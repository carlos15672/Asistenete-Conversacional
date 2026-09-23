const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  const start = Date.now();
  const res = await ai.models.generateContent({
    model: 'gemini-flash-lite-latest',
    contents: 'Recuérdame tomar agua a las 3 de la tarde',
    config: {
      responseMimeType: 'application/json',
      systemInstruction: 'Responde en JSON: {"userSaid":"transcripción de lo que dijo el usuario","action":"CREATE_REMINDER","response":"Entendido, te recordaré tomar agua a las 3:00 PM","title":"Tomar agua","time":"2026-09-22T15:00:00Z"}'
    }
  });
  console.log('Result in', Date.now() - start, 'ms:');
  console.log(res.text.trim());
}
test();
