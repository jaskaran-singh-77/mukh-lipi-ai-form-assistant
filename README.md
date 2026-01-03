<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Mukh-Lipi AI Form Assistant

A voice-first AI form assistant for India that helps users fill out forms using Hindi voice conversations. Powered by Google Gemini AI.

## Features

- 🎤 **Voice-First Interface**: Natural Hindi voice conversations to fill forms
- 📄 **Document Scanning**: Upload identity documents to auto-fill form fields
- 🇮🇳 **Hindi Language Support**: Full Devanagari script support
- 💾 **Local Storage**: Saves drafts and submission history using IndexedDB
- 🎨 **Modern UI**: Beautiful, accessible interface designed for all users

## Run Locally

**Prerequisites:** Node.js (v18 or higher)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jaskaran-singh-77/mukh-lipi-ai-form-assistant.git
   cd mukh-lipi-ai-form-assistant
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   - Create a `.env.local` file in the root directory
   - Add your Gemini API key:
     ```
     GEMINI_API_KEY=your_gemini_api_key_here
     ```
   - Get your API key from: https://aistudio.google.com/app/apikey

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:**
   - Navigate to `http://localhost:3000`

## Deploy to Vercel (Recommended)

1. **Push your code to GitHub** (already done if you're reading this)

2. **Go to [Vercel](https://vercel.com)**
   - Sign up/Login with your GitHub account
   - Click "New Project"
   - Import your repository: `jaskaran-singh-77/mukh-lipi-ai-form-assistant`

3. **Configure Environment Variables:**
   - Go to Project Settings → Environment Variables
   - Add: `GEMINI_API_KEY` = `your_api_key_here`
   - Redeploy

4. **Deploy!**
   - Vercel will automatically deploy your app
   - You'll get a live URL like: `https://your-app.vercel.app`

## Deploy to Netlify

1. **Go to [Netlify](https://www.netlify.com)**
   - Sign up/Login with GitHub
   - Click "Add new site" → "Import an existing project"
   - Select your GitHub repository

2. **Build settings:**
   - Build command: `npm run build`
   - Publish directory: `dist`

3. **Add Environment Variable:**
   - Site settings → Environment variables
   - Add: `GEMINI_API_KEY` = `your_api_key_here`

4. **Deploy!**

## Technology Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Google Gemini AI** - Voice and document processing
- **IndexedDB** - Local data storage
- **Tailwind CSS** - Styling

## Project Structure

```
├── App.tsx          # Main application component
├── api.ts           # Database service (IndexedDB)
├── AudioUtils.ts    # Audio encoding/decoding utilities
├── types.ts         # TypeScript type definitions
└── vite.config.ts   # Vite configuration
```

## License

This project is open source and available for use.

## View on AI Studio

Original AI Studio app: https://ai.studio/apps/drive/1k69CMIzdF47Jr98b1nYvO5ycxGvBqpVR
