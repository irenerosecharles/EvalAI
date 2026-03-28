import { GoogleGenAI, Type } from "@google/genai";
import { pipeline, cos_sim } from '@xenova/transformers';
import Groq from "groq-sdk";

let extractor: any = null;

async function getSbertScore(text1: string, text2: string) {
  try {
    if (!extractor) {
      // Using a small, efficient model for SBERT
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const output1 = await extractor(text1, { pooling: 'mean', normalize: true });
    const output2 = await extractor(text2, { pooling: 'mean', normalize: true });
    
    // output.data is a Float32Array which cos_sim accepts (as number[])
    const similarity = cos_sim(Array.from(output1.data), Array.from(output2.data));
    return Math.max(0, parseFloat(similarity.toFixed(4)));
  } catch (error) {
    console.error("SBERT calculation error:", error);
    return 0;
  }
}

export async function getEmbeddings(text: string) {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export function calculateCosineSimilarity(vec1: number[], vec2: number[]) {
  return cos_sim(vec1, vec2);
}

const getApiKey = () => {
  // Prefer API_KEY (user-selected via openSelectKey) over GEMINI_API_KEY
  const key = (process.env.API_KEY || process.env.GEMINI_API_KEY || "").trim();
  return key;
};

const getAi = () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    // If no Gemini key, we might still have Groq, so we don't throw here
    // but we'll throw when we actually try to use Gemini.
    return null;
  }
  
  // ALWAYS create a new instance to ensure we use the most up-to-date key
  // as per AI Studio guidelines for Gemini 3 models.
  try {
    return new GoogleGenAI({ apiKey });
  } catch (e) {
    console.error("Error initializing GoogleGenAI:", e);
    return null;
  }
};

const getGroq = () => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new Groq({ apiKey });
};

const MODEL_NAME = "gemini-3-flash-preview"; 
const FALLBACK_MODEL = "gemini-3.1-flash-lite-preview";
const GROQ_MODEL = "llama-3.3-70b-versatile";

async function generateText(prompt: string, systemInstruction?: string) {
  // 1. Try Groq first
  const groq = getGroq();
  if (groq) {
    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          ...(systemInstruction ? [{ role: "system" as any, content: systemInstruction }] : []),
          { role: "user" as any, content: prompt }
        ],
        model: GROQ_MODEL,
      });
      const text = chatCompletion.choices[0].message.content;
      if (text) return text;
    } catch (e: any) {
      console.warn("Groq generation failed, falling back to Gemini...", e?.message || e);
    }
  }

  // 2. Fallback to Gemini
  const ai = getAi();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: { systemInstruction }
      });
      return response.text;
    } catch (error: any) {
      const errorMsg = error?.message || "";
      if (errorMsg.includes("API key not valid") || errorMsg.includes("Requested entity was not found")) {
        console.warn("Gemini API Key Issue (Fallback):", errorMsg);
      } else {
        console.warn(`Primary Gemini model ${MODEL_NAME} failed, trying fallback ${FALLBACK_MODEL}`);
        try {
          const response = await ai.models.generateContent({
            model: FALLBACK_MODEL,
            contents: prompt,
            config: { systemInstruction }
          });
          return response.text;
        } catch (e2) {
          console.error("Gemini fallback also failed", e2);
        }
      }
    }
  }

  return null;
}

async function generateJson(prompt: string, schema?: any) {
  // 1. Try Groq first
  const groq = getGroq();
  if (groq) {
    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: "user" as any, content: prompt }],
        model: GROQ_MODEL,
        response_format: { type: "json_object" }
      });
      const content = chatCompletion.choices[0].message.content;
      if (content) return JSON.parse(content);
    } catch (e: any) {
      console.warn("Groq JSON generation failed, falling back to Gemini...", e?.message || e);
    }
  }

  // 2. Fallback to Gemini
  const ai = getAi();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });
      if (response.text) {
        const cleanText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
      }
    } catch (error: any) {
      console.warn("Gemini JSON generation failed", error?.message || error);
    }
  }

  return null;
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
    // 1. Word Count Analysis
    const studentWords = studentAnswer.trim().split(/\s+/).filter(w => w.length > 0).length;

    // 2. Generate an "Ideal Answer"
    let idealAnswer = reference || "No ideal answer provided.";
    const idealPrompt = `As an expert academic, provide a concise, comprehensive, and accurate "Gold Standard" answer for the following question. 
    This will be used to evaluate a student's response.
    
    Question: ${question}
    ${reference ? `Teacher's Hint/Reference: ${reference}` : ""}
    
    Provide only the ideal answer text.`;

    const generatedIdeal = await generateText(idealPrompt);
    if (generatedIdeal) {
      idealAnswer = generatedIdeal;
    }

    // 3. SBERT Calculation (Semantic Similarity)
    const sbertScore = await getSbertScore(studentAnswer, idealAnswer);

    // 4. Feedback Generation
    const evaluationPrompt = `
      You are an expert academic evaluator. A student has answered a question.
      
      Question: ${question}
      AI Ideal Answer: ${idealAnswer}
      Student Answer: ${studentAnswer}
      SBERT Similarity Score: ${sbertScore.toFixed(4)}
      
      Word Count Constraints:
      - Minimum Words Required: ${minWords || "None"}
      - Maximum Words Allowed: ${maxWords || "None"}
      - Student's Actual Word Count: ${studentWords}
      
      Evaluation Rubric (Total 100%):
      1. Content Accuracy (40%): How factually correct is the answer compared to the ideal answer? (Use SBERT score as a guide)
      2. Depth & Detail (30%): Does the student provide sufficient explanation and context?
      3. Structure & Clarity (20%): Is the answer well-organized and easy to understand?
      4. Word Count Adherence (10%): Does the answer meet the length requirements?
      
      Scoring Penalties:
      - CRITICAL: If studentWords < (minWords * 0.2), Content Accuracy and Depth MUST be capped at 0.
      - If studentWords < (minWords * 0.5), Content Accuracy and Depth MUST be capped at 50% of their max.
      - If studentWords > maxWords, apply a 10% penalty to the final score.
      
      Instructions:
      - First, perform a "reasoning" step where you analyze the student's answer against each rubric point.
      - Then, calculate the final "score" (0.0 to 1.0).
      - Provide specific "strengths" and "improvements".
      - Write a professional "feedback" summary.
      
      IMPORTANT: Return ONLY a valid JSON object with keys: reasoning, score, strengths, improvements, feedback.
    `;

    const schema = {
      type: Type.OBJECT,
      properties: {
        reasoning: { type: Type.STRING },
        score: { type: Type.NUMBER },
        strengths: { type: Type.STRING },
        improvements: { type: Type.STRING },
        feedback: { type: Type.STRING }
      },
      required: ["reasoning", "score", "strengths", "improvements", "feedback"]
    };

    const result = await generateJson(evaluationPrompt, schema);

    if (!result) {
      return {
        strengths: "N/A",
        improvements: "N/A",
        score: parseFloat((sbertScore * maxMarks).toFixed(1)),
        feedback: "Evaluation fallback triggered due to an error.",
        reasoning: "SBERT similarity used as score.",
        isValid: sbertScore > 0.3,
        wordCount: studentWords,
        maxMarks: maxMarks,
        sbertScore: sbertScore
      };
    }

    const qualityScore = Math.max(0, Math.min(1, result.score || 0));
    let finalScore = qualityScore * maxMarks;
    finalScore = Math.max(0, Math.min(maxMarks, finalScore));

    return {
      strengths: result.strengths || "Good attempt.",
      improvements: result.improvements || "Keep practicing.",
      score: parseFloat(finalScore.toFixed(1)),
      feedback: result.feedback,
      reasoning: result.reasoning,
      isValid: qualityScore > 0.3,
      wordCount: studentWords,
      maxMarks: maxMarks,
      sbertScore: sbertScore
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
