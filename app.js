// app.js
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const fetch = require('node-fetch'); // v2 API (CommonJS)
const path = require('path');
const FormData = require('form-data');

// Environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const hfToken = process.env.HUGGINGFACE_API_TOKEN;

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}
if (!hfToken) {
  console.warn("HUGGINGFACE_API_TOKEN is missing. Transcription/TTS will fail.");
}

// Initialize bot (polling)
const bot = new TelegramBot(token, { polling: true });

// Ensure tmp directory exists
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

// Logging helper
const log = (...args) => console.log(new Date().toISOString(), ...args);

// /start command
bot.onText(/\/start/i, (msg) => {
  log("Received /start from", msg.chat.id);
  bot.sendMessage(msg.chat.id, "👋 Welcome to Aurivox! Send me a voice note and I’ll reply with AI speech.");
});

// Voice handler
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  log("Received voice message from", chatId, "file_id:", fileId);

  try {
    // 1) Get downloadable link
    const fileLink = await bot.getFileLink(fileId);
    log("File link:", fileLink);

    // 2) Download OGG
    const response = await fetch(fileLink);
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    const buffer = await response.buffer();

    // 3) Save to tmp
    const oggPath = path.join(tmpDir, `${fileId}.ogg`);
    fs.writeFileSync(oggPath, buffer);
    log("Saved voice to", oggPath);

    // 4) Transcribe with HF Whisper
    if (!hfToken) {
      await bot.sendMessage(chatId, "⚠️ Hugging Face token not set. Cannot transcribe.");
      return;
    }

    const formData = new FormData();
    formData.append("file", fs.createReadStream(oggPath));

    log("Transcribing audio with Hugging Face Whisper...");
    const transcribeRes = await fetch(
      "https://api-inference.huggingface.co/models/openai/whisper-small",
      { method: "POST", headers: { Authorization: `Bearer ${hfToken}` }, body: formData }
    );

    if (!transcribeRes.ok) {
      const errText = await transcribeRes.text();
      throw new Error(`Transcription failed: ${transcribeRes.status} ${errText}`);
    }

    const transcribeData = await transcribeRes.json();
    const text = transcribeData.text || (transcribeData[0]?.text) || "⚠️ Could not transcribe audio.";
    log("Transcription:", text);

    await bot.sendMessage(chatId, `📝 Transcription: ${text}`);

    // 5) TTS reply (generate audio from text)
    log("Generating TTS with Hugging Face...");
    const ttsRes = await fetch(
      "https://api-inference.huggingface.co/models/facebook/mms-tts-eng",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfToken}`,
          "Content-Type": "application/json"
        },
        body: ({ inputs: text })
      }
    );
