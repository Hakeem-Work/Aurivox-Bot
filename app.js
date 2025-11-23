// app.js
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const fetch = require('node-fetch');
const path = require('path');
const FormData = require('form-data');

// Load environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const hfToken = process.env.HUGGINGFACE_API_TOKEN;

// Initialize bot in polling mode
const bot = new TelegramBot(token, { polling: true });

// Ensure tmp directory exists
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "👋 Welcome to Aurivox! Send me a voice note and I’ll reply with AI speech.");
});

// Handle voice messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  try {
    // Get file link from Telegram
    const fileLink = await bot.getFileLink(fileId);

    // Download the voice file
    const response = await fetch(fileLink);
    const buffer = await response.buffer();

    // Save the file locally
    const filePath = path.join(tmpDir, `${fileId}.ogg`);
    fs.writeFileSync(filePath, buffer);

    // Send to Hugging Face Whisper for transcription
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    const transcribeRes = await fetch(
      "https://api-inference.huggingface.co/models/openai/whisper-small",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${hfToken}` },
        body: formData,
      }
    );

    const transcribeData = await transcribeRes.json();
    const text = transcribeData.text || "⚠️ Could not transcribe audio.";

    // Send transcription back
    await bot.sendMessage(chatId, `📝 Transcription: ${text}`);

    // Send to Hugging Face TTS for speech reply
    const ttsRes = await fetch(
      "https://api-inference.huggingface.co/models/facebook/mms-tts-eng",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    const ttsBuffer = await ttsRes.buffer();
    const ttsPath = path.join(tmpDir, `${fileId}.wav`);
    fs.writeFileSync(ttsPath, ttsBuffer);

    // Reply with audio
    await bot.sendAudio(chatId, ttsPath);

  } catch (error) {
    console.error("Voice handling error:", error);
    bot.sendMessage(chatId, "⚠️ Sorry, I couldn’t process your voice note.");
  }
});

console.log("Aurivox bot is running in polling mode...");
