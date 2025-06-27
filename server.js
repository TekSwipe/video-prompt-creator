// server.js (Corrected to match the original prompt structure exactly)
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
app.use(express.json({ limit: '10mb' }));
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/presentation', (req, res) => res.sendFile(path.join(__dirname, 'presentation.html')));

app.get('/generate-presentation', async (req, res) => {
    const sseStream = new SseStream(res);
    const { businessIdea } = req.query;
    if (!businessIdea) {
        sseStream.send({ status: 'error', message: 'Business idea is required.' });
        sseStream.close();
        return;
    }
    try {
        const { generatedData } = await runGeneration(sseStream, { businessIdea });
        sseStream.send({ status: 'complete', message: 'Video generation complete!', percentage: 100, videoUrl: '/presentation.mp4', generatedData });
    } catch (error) {
        console.error('Initial generation error:', error);
        sseStream.send({ status: 'error', message: `Error: ${error.message}` });
    } finally {
        sseStream.close();
    }
});

app.post('/recreate-presentation', async (req, res) => {
    const sseStream = new SseStream(res);
    const editedData = req.body;
    if (!editedData) {
        sseStream.send({ status: 'error', message: 'No edited data received.' });
        sseStream.close();
        return;
    }
    try {
        await runGeneration(sseStream, { editedData });
        sseStream.send({ status: 'complete', message: 'Video recreated successfully!', percentage: 100, videoUrl: '/presentation.mp4' });
    } catch (error) {
        console.error('Recreation error:', error);
        sseStream.send({ status: 'error', message: `Error: ${error.message}` });
    } finally {
        sseStream.close();
    }
});


// --- Core Logic ---
class SseStream {
    constructor(res) {
        this.res = res;
        this.res.setHeader('Content-Type', 'text/event-stream');
        this.res.setHeader('Cache-Control', 'no-cache');
        this.res.setHeader('Connection', 'keep-alive');
        this.res.flushHeaders();
    }
    send(data) { this.res.write(`data: ${JSON.stringify(data)}\n\n`); }
    close() { this.res.end(); }
}

async function runGeneration(sseStream, { businessIdea, editedData }) {
    const audioDir = path.join(publicDir, 'audio');
    await fs.rm(publicDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(audioDir, { recursive: true });

    let generatedData;
    let progressOffset = 0;

    if (businessIdea) {
        sseStream.send({ status: 'processing', message: '[1/7] Initializing...', percentage: 5 });
        sseStream.send({ status: 'processing', message: '[2/7] Generating prompt & script...', percentage: 15 });
        generatedData = await generatePromptAndScript(businessIdea);
        progressOffset = 2;
    } else {
        sseStream.send({ status: 'processing', message: '[1/5] Initializing recreation...', percentage: 5 });
        generatedData = editedData;
    }
    
    await fs.writeFile(path.join(publicDir, 'data.json'), JSON.stringify(generatedData, null, 2));
    
    const basePercentage = businessIdea ? 20 : 5;
    sseStream.send({ status: 'processing', message: `[${3 + progressOffset - 2}/7] Generating voiceover audio...`, percentage: basePercentage + 25 });
    const audioFilePaths = await Promise.all(generatedData.voiceoverScript.map(async (script, i) => {
        const audioPath = path.join(audioDir, `audio_${i}.mp3`);
        await generateAudio(script.text, audioPath);
        return audioPath;
    }));

    sseStream.send({ status: 'processing', message: `[${4 + progressOffset - 2}/7] Merging audio files...`, percentage: basePercentage + 50 });
    await concatenateAudio(audioFilePaths, path.join(publicDir, 'full_audio.mp3'));

    sseStream.send({ status: 'processing', message: `[${5 + progressOffset - 2}/7] Recording presentation...`, percentage: basePercentage + 65 });
    await recordPresentation(path.join(publicDir, 'temp_video.mp4'));

    sseStream.send({ status: 'processing', message: `[${6 + progressOffset - 2}/7] Finalizing video...`, percentage: basePercentage + 80 });
    await mergeVideoAndAudio(path.join(publicDir, 'temp_video.mp4'), path.join(publicDir, 'full_audio.mp3'), path.join(publicDir, 'presentation.mp4'));
    
    fs.unlink(path.join(publicDir, 'temp_video.mp4')).catch(()=>{});
    fs.unlink(path.join(publicDir, 'full_audio.mp3')).catch(()=>{});
    fs.rm(audioDir, { recursive: true, force: true }).catch(()=>{});

    return { generatedData };
}

// --- FINAL Gemini Prompt matching original reference ---
async function generatePromptAndScript(businessIdea) {
    const prompt = `
        You are an AI assistant creating a structured prompt and voiceover script for a tutorial video.
        The tutorial shows how to use AI to build a website for a specific business idea.
        Business Idea: "${businessIdea}"

        You must return a single, valid JSON object with no other text.
        The JSON object must have ONLY two keys: "promptLines" and "voiceoverScript".

        1.  **promptLines**: An array of strings. Follow the exact order from the example. For words that should be highlighted, wrap them in <highlight> tags. The hero image line must be firm about using only one image.
            The EXACT order of lines is: 
            1. Title
            2. Business Type
            3. Business Name
            4. File structure (HTML/CSS/JS)
            5. Complete Website (header/footer)
            6. Modern look (micro animations)
            7. SEO friendly
            8. 7 to 10 sections
            9. Web3Forms
            10. Sample Code
            11. Hero Image
            12. Surprise me
            13. YouTube Description
            
            Example structure:
            [
                "> _ Creating The Prompt",
                "You will create a one page website for a <highlight>dog poop scoop business</highlight>.",
                "the shop is called <highlight>\\"Pick Up Poo\\"</highlight>.",
                "All the <highlight>HTML, CSS and JS</highlight> will be in the one file.",
                "Make it a <highlight>complete website</highlight> with a <highlight>header, footer</highlight> ect.",
                "Make it look <highlight>modern</highlight> like it was created professionally, add <highlight>micro animations</highlight>, it shouldn't look like a standard cookie cutter website, make it mind blowing good!",
                "Make it <highlight>SEO friendly</highlight>.",
                "Make sure the website has many sections, at least have <highlight>7 to 10 sections</highlight>.",
                "I will be using <highlight>web3forms</highlight> for the contact form section, here is the sample code for the from (I have included my access key in the code, please use that access code.):",
                "--Enter Sample Code Here--",
                "I only have one photo I called <highlight>“website hero.png”</highlight>, which is a dog on the right looking to the left, it will be in the root directory, do not add any more photos to the website other than this one.",
                "Please <highlight>surprise me</highlight>.",
                "<highlight>**This prompt is in the YouTube Description**</highlight>"
            ]

        2.  **voiceoverScript**: An array of objects. The second voiceover must mention the generated business name. The final voiceover must state the prompt is in the description.
            Example format:
            [
              {"text": "First, we tell the AI what we're building: a one-page website for our business idea.", "appliesToLines": [1]},
              {"text": "We'll give our business a catchy name, like 'Pick Up Poo'.", "appliesToLines": [2]},
              {"text": "To keep it simple, we'll ask for all code in one file, for a complete website that looks modern and has micro-animations.", "appliesToLines": [3, 4, 5]},
              {"text": "We'll also make sure it's SEO friendly and has between seven to ten sections.", "appliesToLines": [6, 7]},
              {"text": "For user contact, we'll specify using a web3forms integration.", "appliesToLines": [8, 9]},
              {"text": "Visually, we'll instruct the AI to use only one specific hero image. You can of course edit this prompt to add more images later.", "appliesToLines": [10]},
              {"text": "Finally, we ask the AI to surprise us, you can this full prompt is in the YouTube description below.", "appliesToLines": [11, 12]}
            ]

        Now, generate the complete and valid JSON object for the business idea: "${businessIdea}".
    `;

    const result = await geminiModel.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedJsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJsonString);
}


// --- Helper functions ---
async function recordPresentation(videoPath) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`http://localhost:${PORT}/presentation`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#prompt-container', { visible: true });
    await new Promise(resolve => setTimeout(resolve, 300));
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
    if (!response.ok) { throw new Error(`DeepInfra API failed: ${await response.text()}`); }
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
}
function concatenateAudio(audioFiles, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg().input(`concat:${audioFiles.join('|')}`).outputOptions('-acodec copy')
            .on('error', (err) => reject(new Error(`FFmpeg audio concat error: ${err.message}`)))
            .on('end', () => resolve()).save(outputPath);
    });
}
function mergeVideoAndAudio(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg().input(videoPath).input(audioPath)
            .outputOptions(['-c:v copy', '-c:a aac', '-strict experimental', '-shortest'])
            .on('error', (err) => reject(new Error(`FFmpeg merge error: ${err.message}`)))
            .on('end', () => resolve()).save(outputPath);
    });
}

app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));