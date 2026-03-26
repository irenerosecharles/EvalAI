import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  const key = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  return key;
};

let aiInstance: GoogleGenAI | null = null;

const getAi = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("CRITICAL: No API key found in GEMINI_API_KEY or API_KEY environment variables.");
    throw new Error("GEMINI_API_KEY is not set in environment variables.");
  }
  
  if (!aiInstance) {
    try {
      aiInstance = new GoogleGenAI({ apiKey });
      console.log("GoogleGenAI instance initialized successfully.");
    } catch (e) {
      console.error("Error initializing GoogleGenAI:", e);
      throw e;
    }
  }
  return aiInstance;
};

const MODEL_NAME = "gemini-flash-latest"; 
const FALLBACK_MODEL = "gemini-3.1-flash-lite-preview";

async function generateWithFallback(params: any) {
  const ai = getAi();
  try {
    return await ai.models.generateContent({ ...params, model: MODEL_NAME });
  } catch (error) {
    console.warn(`Primary model ${MODEL_NAME} failed, trying fallback ${FALLBACK_MODEL}`, error);
    return await ai.models.generateContent({ ...params, model: FALLBACK_MODEL });
  }
}

export async function evaluateAnswer(
  question: string, 
  reference: string | undefined, 
  studentAnswer: string, 
  maxMarks: number,
  minWords: number = 0,
  maxWords: number = 0
) {
  try {
    // 1. Word Count Analysis (for context)
    const studentWords = studentAnswer.trim().split(/\s+/).filter(w => w.length > 0).length;

    // 2. Generate an "Ideal Answer" using Gemini to serve as the gold standard
    const idealAnswerResponse = await generateWithFallback({
      contents: `As an expert academic, provide a concise, comprehensive, and accurate "Gold Standard" answer for the following question. 
      This will be used to evaluate a student's response.
      
      Question: ${question}
      ${reference ? `Teacher's Hint/Reference: ${reference}` : ""}
      
      Provide only the ideal answer text.`
    });

    const idealAnswer = idealAnswerResponse.text || reference || "No ideal answer could be generated.";

    // 3. Gemini for Full Evaluation (Marks & Feedback)
    const response = await generateWithFallback({
      contents: `
        You are an expert academic evaluator. A student has answered a question.
        
        Question: ${question}
        AI Ideal Answer: ${idealAnswer}
        Student Answer: ${studentAnswer}
        
        Word Count Constraints:
        - Minimum Words Required: ${minWords || "None"}
        - Maximum Words Allowed: ${maxWords || "None"}
        - Student's Actual Word Count: ${studentWords}
        
        Evaluation Guidelines:
        1. score: (0.0 to 1.0) Overall score based on accuracy, depth, and word count adherence.
           - CRITICAL: HEAVILY PENALIZE if the word count is significantly below the minimum. 
             An answer that is less than 10% of the minimum word count should NEVER receive more than 10% of the marks.
        2. strengths: A brief list of what the student did well.
        3. improvements: A brief list of specific areas for improvement.
        4. feedback: A detailed, justifiable, and professional summary (3-4 sentences). Explain exactly why the marks were awarded or deducted.
        
        Provide the evaluation in JSON format.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            strengths: { type: Type.STRING },
            improvements: { type: Type.STRING },
            feedback: { type: Type.STRING }
          },
          required: ["score", "strengths", "improvements", "feedback"]
        }
      }
    });

    const result = JSON.parse(response.text);
    const qualityScore = Math.max(0, Math.min(1, result.score || 0));
    
    let finalScore = qualityScore * maxMarks;
    finalScore = Math.max(0, Math.min(maxMarks, finalScore));

    return {
      strengths: result.strengths || "Good attempt.",
      improvements: result.improvements || "Keep practicing.",
      score: parseFloat(finalScore.toFixed(1)),
      feedback: result.feedback,
      isValid: qualityScore > 0.3,
      wordCount: studentWords,
      maxMarks: maxMarks
    };
  } catch (error) {
    console.error("Evaluation error:", error);
    return {
      strengths: "N/A",
      improvements: "N/A",
      score: maxMarks * 0.5,
      feedback: "Evaluation fallback triggered due to an error.",
      isValid: true,
      wordCount: 0,
      maxMarks: maxMarks
    };
  }
}
