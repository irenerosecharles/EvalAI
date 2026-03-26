# EvalAI - Automated Descriptive Answer Evaluation System

EvalAI is a full-stack platform for academic evaluation. It allows teachers to create classrooms and activities (Exams, Quizzes, Assignments) and automatically evaluates student descriptive answers using AI.

## Features

- **Teacher Dashboard**: Manage classrooms, create activities with join codes, view analytics, and override AI-generated marks.
- **Student Dashboard**: Join activities via code, take timed exams with auto-save, and view detailed AI feedback.
- **AI Evaluation Pipeline**:
  - **Semantic Similarity**: Compares student answers to reference answers.
  - **Grammar Scoring**: Evaluates language quality.
  - **Ollama-style Feedback**: Generates descriptive feedback, strengths, and improvements.
- **Export**: Results can be exported for record-keeping.
- **Real-time Notifications**: In-app alerts for evaluation completion.

## Tech Stack

- **Frontend**: React, Tailwind CSS, Recharts, Framer Motion
- **Backend**: Node.js, Express (TypeScript)
- **Database**: MongoDB (Mongoose)
- **AI Engine**: Google Gemini API (Simulating SBERT + Ollama pipeline)

## Setup Instructions

1. **Environment Variables**:
   - `GEMINI_API_KEY`: Your Google AI Studio API key.
   - `MONGODB_URI`: Your MongoDB connection string.
   - `JWT_SECRET`: A secret key for token signing.

2. **Running Locally**:
   - `npm install`
   - `npm run dev`

3. **AI Evaluation Note**: 
   In this cloud environment, the SBERT (local Python) and Ollama (local LLM) components are simulated using the Gemini API to provide a fully functional preview. In a local deployment, these can be swapped for the specific Python services described in the project report.
