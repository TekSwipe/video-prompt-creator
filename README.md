# AI Prompt Video Generator

A simple Node.js application that automatically generates a video presentation from a text prompt. It uses AI to create the script and voiceover, then records the presentation using Puppeteer.

---

### Prerequisites

Before you begin, you will need the following installed on your system:

-   [Node.js](https://nodejs.org/) (v16 or higher)
-   **FFmpeg**: This is **required** for merging the audio and video. You must install it and ensure it is accessible from your system's command line PATH. You can download it from the [official FFmpeg website](https://ffmpeg.org/download.html).

---

### Setup and Installation

Follow these simple steps to get the project running.

**1. Clone the Repository**

```bash
git clone https://github.com/your-username/ai-prompt-video-generator.git
cd ai-prompt-video-generator
```

**2. Install Dependencies**

Run the following command in your terminal to install all the necessary packages:

```bash
npm i express dotenv @google/generative-ai puppeteer puppeteer-screen-recorder node-fetch@2 cors fluent-ffmpeg @ffmpeg-installer/ffmpeg
```

**3. Configure Environment Variables**

Create a new file named `.env` in the root of the project folder and add your API keys.

```env
# .env

# Your API key from Google AI Studio
GEMINI_API_KEY="YOUR_GOOGLE_AI_STUDIO_API_KEY"

# Your API key from DeepInfra
DEEPINFRA_API_KEY="YOUR_DEEPINFRA_API_KEY"```

---

### Running the Application

**1. Start the Server**

```bash
node server.js
```

**2. Open the App**

The server will start and be accessible in your web browser at:
[http://localhost:3000](http://localhost:3000)

Enter a business idea and click "Generate Video" to begin the process.