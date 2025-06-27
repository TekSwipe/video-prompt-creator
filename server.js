// server.js (Corrected)
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" }); // Using public model for compatibility

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/presentation', (req, res) => res.sendFile(path.join(__dirname, 'presentation.html')));

app.get('/generate-presentation', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { businessIdea } = req.query;
    if (!businessIdea) {
        res.write(`data: ${JSON.stringify({ status: 'error', message: 'Business idea is required.' })}\n\n`);
        res.end();
        return;
    }

    const sendProgress = (progress) => {
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
    };

    const audioDir = path.join(publicDir, 'audio');
    const fullAudioPath = path.join(publicDir, 'full_audio.mp3');
    const tempVideoPath = path.join(publicDir, 'temp_video.mp4');
    const finalVideoPath = path.join(publicDir, 'presentation.mp4');

    try {
        sendProgress({ status: 'processing', message: '[1/7] Initializing...', percentage: 5 });
        await fs.rm(publicDir, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(audioDir, { recursive: true });
        sendProgress({ status: 'processing', message: '[2/7] Cleaning up workspace...', percentage: 10 });

        sendProgress({ status: 'processing', message: '[3/7] Generating prompt & script...', percentage: 25 });
        const generatedData = await generatePromptAndScript(businessIdea);
        await fs.writeFile(path.join(publicDir, 'data.json'), JSON.stringify(generatedData, null, 2));

        sendProgress({ status: 'processing', message: '[4/7] Generating voiceover audio...', percentage: 50 });
        const audioFilePaths = await Promise.all(generatedData.voiceoverScript.map(async (script, i) => {
            const audioPath = path.join(audioDir, `audio_${i}.mp3`);
            await generateAudio(script.text, audioPath);
            return audioPath;
        }));

        sendProgress({ status: 'processing', message: '[5/7] Merging audio files...', percentage: 70 });
        await concatenateAudio(audioFilePaths, fullAudioPath);

        sendProgress({ status: 'processing', message: '[6/7] Recording presentation video...', percentage: 85 });
        await recordPresentation(tempVideoPath);

        sendProgress({ status: 'processing', message: '[7/7] Merging final video and audio...', percentage: 95 });
        await mergeVideoAndAudio(tempVideoPath, fullAudioPath, finalVideoPath);

        sendProgress({ status: 'complete', message: 'Video generation complete!', percentage: 100, videoUrl: '/presentation.mp4' });

    } catch (error) {
        console.error('An error occurred during presentation generation:', error);
        sendProgress({ status: 'error', message: `Error: ${error.message}` });
    } finally {
        fs.unlink(tempVideoPath).catch(() => {});
        fs.unlink(fullAudioPath).catch(() => {});
        fs.rm(audioDir, { recursive: true, force: true }).catch(() => {});
        res.end();
    }
});


// --- Helper Functions ---

async function generatePromptAndScript(businessIdea) {
    const prompt = `
        You are an AI assistant creating a structured prompt and voiceover script for a tutorial video.
        The tutorial shows how to use AI to build a website for a specific business idea.
        Business Idea: "${businessIdea}"

        You must return a single, valid JSON object with no other text.
        The JSON object must have three keys: "promptLines", "highlightedWords", and "voiceoverScript".

        1.  **promptLines**: An array of strings.
            Example structure:
            [
                "> _ Creating The Prompt",
                "You will create a one page website for a dog walking business.",
                "the shop is called \\"Pawsitive Strides\\".",
                "All the HTML, CSS and JS will be in the one file.",
                "Make it a complete website with a header, footer ect.",
                "Make it look modern like it was created professionally, add micro animations, it shouldn't look like a standard cookie cutter website, make it mind blowing good!",
                "Make it SEO friendly.",
                "Make sure the website has many sections, at least have 7 to 10 sections.",
                "I will be using web3forms for the contact form section, here is the sample code for the from (I've included my access key in the code, please use that access code.):",
                "--Enter Sample Code Here--",
                "I only have one photo I called “website hero.png”, which is a happy dog on a walk. This will be the main hero image. If you have more images, you can update this part of the prompt to include them.",
                "Please surprise me!",
                "**This prompt is in the YouTube description below for you to customize.**"
            ]

        2.  **highlightedWords**: An array of objects to identify words to highlight.
            Example format:
            [
                {"lineIndex": 1, "words": ["dog walking business"]},
                {"lineIndex": 2, "words": ["\\"Pawsitive Strides\\""]},
                {"lineIndex": 3, "words": ["HTML, CSS and JS"]},
                {"lineIndex": 4, "words": ["complete website", "header, footer"]},
                {"lineIndex": 5, "words": ["modern", "micro animations"]},
                {"lineIndex": 6, "words": ["SEO friendly"]},
                {"lineIndex": 7, "words": ["7 to 10 sections"]},
                {"lineIndex": 8, "words": ["web3forms"]},
                {"lineIndex": 10, "words": ["“website hero.png”", "update this part"]}
            ]

        3.  **voiceoverScript**: An array of objects. The final voiceover line should ONLY say "Finally, we tell the AI to surprise us!".
            Example format:
            [
              {"text": "First, we tell the AI what we're building: a one-page website for our business idea.", "appliesToLines": [1]},
              {"text": "We'll give our business a catchy name.", "appliesToLines": [2]},
              {"text": "To keep it simple, we'll ask for all code in one file, for a complete, modern site with micro-animations.", "appliesToLines": [3, 4, 5]},
              {"text": "The site needs to be substantial and SEO-friendly, so we'll request 7 to 10 sections.", "appliesToLines": [6, 7]},
              {"text": "For user contact, we'll specify using a web3forms integration.", "appliesToLines": [8, 9]},
              {"text": "We'll instruct the AI to use one specific hero image, and note that this prompt can be customized with more images.", "appliesToLines": [10]},
              {"text": "Finally, we tell the AI to surprise us!", "appliesToLines": [11, 12]},
              {"text": "This prompt template will be in the YouTube description.", "appliesToLines": [13]}
            ]

        Now, generate the complete and valid JSON object for the business idea: "${businessIdea}".
    `;

    const result = await geminiModel.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJsonString);
}

async function recordPresentation(videoPath) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`http://localhost:${PORT}/presentation`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#prompt-container', { visible: true });
    await page.evaluate(() => document.body.style.backgroundColor = 'black'); // Ensure background is black
    await new Promise(resolve => setTimeout(resolve, 300)); // Buffer for paint

    const recorder = new PuppeteerScreenRecorder(page, { fps: 25 });
    await recorder.start(videoPath);
    await page.waitForFunction(() => document.title === 'presentation-finished', { timeout: 300000 });
    await recorder.stop();
    await browser.close();
}

async function generateAudio(text, outputPath) {
    const response = await fetch("https://api.deepinfra.com/v1/openai/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DEEPINFRA_API_KEY}` },
        body: JSON.stringify({ model: "hexgrad/Kokoro-82M", input: text, voice: "af_heart", response_format: "mp3" }),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`DeepInfra API failed: ${errorBody}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
}

function concatenateAudio(audioFiles, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg().input('concat:' + audioFiles.join('|'))
            .outputOptions('-acodec copy')
            .on('error', (err) => reject(new Error(`FFmpeg audio concatenation error: ${err.message}`)))
            .on('end', () => resolve())
            .save(outputPath);
    });
}

function mergeVideoAndAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg().input(videoPath).input(audioPath)
            .outputOptions(['-c:v copy', '-c:a aac', '-strict experimental', '-shortest'])
            .on('error', (err) => reject(new Error(`FFmpeg merge error: ${err.message}`)))
            .on('end', () => resolve())
            .save(outputPath);
    });
}

app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));