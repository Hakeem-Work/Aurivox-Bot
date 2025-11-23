require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Telegram bot setup
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Health endpoint for Railway
app.get('/', (req, res) => {
  res.send('Aurivox bot is running!');
});

app.listen(PORT, () => {
  console.log(`Aurivox health endpoint listening on :${PORT}`);
});

// Handle /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Welcome to Aurivox! Send me a voice note and I’ll reply with AI speech.');
});

// Handle voice messages
bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const fileId = msg.voice.file_id;

  try {
    // Get file link from Telegram
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    // Download OGG file
    const oggPath = `tmp/${fileId}.ogg`;
    const mp3Path = `tmp/${fileId}.mp3`;
    const writer = fs.createWriteStream(oggPath);
    const response = await axios({ url: fileUrl, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Convert OGG to MP3
    await new Promise((resolve, reject) => {
      ffmpeg(oggPath).toFormat('mp3').save(mp3Path).on('end', resolve).on('error', reject);
    });

    // Send MP3 to Hugging Face ASR
    const audioData = fs.readFileSync(mp3Path);
    const asrResponse = await axios.post(
      'https://api-inference.huggingface.co/models/openai/whisper-small',
      audioData,
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`,
          'Content-Type': 'audio/mpeg',
        },
      }
    );

    const text = asrResponse.data.text || 'Sorry, I could not transcribe that.';

    // Generate AI speech reply
    const ttsResponse = await axios.post(
      'https://api-inference.huggingface.co/models/facebook/mms-tts-eng',
      { inputs: text },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
      }
    );

    const replyPath = `tmp/reply_${fileId}.mp3`;
    fs.writeFileSync(replyPath, Buffer.from(ttsResponse.data));

    // Send back audio reply
    await bot.sendAudio(chatId, replyPath, {}, { filename: 'reply.mp3', contentType: 'audio/mpeg' });

    // Cleanup
    fs.unlinkSync(oggPath);
    fs.unlinkSync(mp3Path);
    fs.unlinkSync(replyPath);

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, '⚠️ Something went wrong processing your voice note.');
  }
});
