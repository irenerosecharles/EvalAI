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

const getGroq = () => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return new Groq({ apiKey });
};

const GROQ_MODEL = "llama-3.3-70b-versatile";

async function generateText(prompt: string, systemInstruction?: string) {
  const groq = getGroq();
  if (!groq) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        ...(systemInstruction ? [{ role: "system" as any, content: systemInstruction }] : []),
        { role: "user" as any, content: prompt }
      ],
      model: GROQ_MODEL,
    });
    return chatCompletion.choices[0].message.content || null;
  } catch (e: any) {
    console.error("Groq generation failed:", e?.message || e);
    return null;
  }
}

async function generateJson(prompt: string, systemInstruction?: string) {
  const groq = getGroq();
  if (!groq) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        ...(systemInstruction ? [{ role: "system" as any, content: systemInstruction }] : []),
        { role: "user" as any, content: prompt }
      ],
      model: GROQ_MODEL,
      response_format: { type: "json_object" }
    });
    const content = chatCompletion.choices[0].message.content;
    if (content) return JSON.parse(content);
  } catch (e: any) {
    console.error("Groq JSON generation failed:", e?.message || e);
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

    // 2. Generate an "Ideal Answer" using Groq
    let idealAnswer = reference || "No ideal answer provided.";
    const idealPrompt = `As an expert academic, provide a comprehensive, accurate, and multi-faceted "Gold Standard" answer for the following question. 
    Include key concepts, terminology, and different ways the answer could be correctly expressed.
    This will be used as a benchmark to evaluate a student's response.
    
    Question: ${question}
    ${reference ? `Teacher's Hint/Reference: ${reference}` : ""}
    
    Provide only the ideal answer text.`;

    const generatedIdeal = await generateText(idealPrompt);
    if (generatedIdeal) {
      idealAnswer = generatedIdeal;
    }

    // 3. SBERT Calculation (Semantic Similarity)
    const sbertScore = await getSbertScore(studentAnswer, idealAnswer);

    // 4. Feedback Generation using Groq
    const systemInstruction = "You are an expert academic evaluator known for being fair, encouraging, and liberal in awarding marks for conceptual understanding. You prioritize the 'spirit' of the answer and award partial credit generously.";
    const evaluationPrompt = `
      A student has answered a question. Evaluate their response based on the provided rubric.
      
      Question: ${question}
      AI Ideal Answer: ${idealAnswer}
      Student Answer: ${studentAnswer}
      SBERT Similarity Score: ${sbertScore.toFixed(4)}
      
      Word Count Constraints:
      - Minimum Words Required: ${minWords || "None"}
      - Maximum Words Allowed: ${maxWords || "None"}
      - Student's Actual Word Count: ${studentWords}
      
      Evaluation Rubric (Total 100%):
      1. Conceptual Accuracy (50%): Does the student demonstrate a correct understanding of the core concepts? Focus on the "spirit" of the answer rather than exact wording.
      2. Depth & Detail (30%): Does the student provide sufficient explanation? Award partial marks even for brief but correct points.
      3. Clarity & Expression (15%): Is the answer understandable? Do not penalize heavily for minor grammatical errors.
      4. Word Count Adherence (5%): Only apply a small penalty if the answer is significantly outside the requested range.
      
      Scoring Guidelines:
      - BE LIBERAL: If the student is on the right track, give them the benefit of the doubt.
      - PARTIAL CREDIT: Always award partial marks for any correct information provided.
      - CONCEPT OVER FORM: Prioritize the correctness of the ideas over the length or structure of the response.
      - SBERT GUIDE: The SBERT score is a mathematical guide; use your human-like reasoning to identify correct concepts that SBERT might miss due to different phrasing.
      
      Penalties (Apply ONLY if strictly necessary):
      - If studentWords < (minWords * 0.3), apply a maximum 30% penalty to the total score (do not cap at 0 unless the answer is completely irrelevant).
      - If studentWords > maxWords, apply a maximum 5% penalty.
      
      Instructions:
      - First, perform a "reasoning" step where you analyze the student's answer against each rubric point, highlighting where you've awarded marks for correct concepts.
      - Then, calculate the final "score" (0.0 to 1.0).
      - Provide specific "strengths" and "improvements".
      - Write a professional and encouraging "feedback" summary.
      
      IMPORTANT: Return ONLY a valid JSON object with keys: reasoning, score, strengths, improvements, feedback.
    `;

    const result = await generateJson(evaluationPrompt, systemInstruction);

    if (!result) {
      // Fallback with a slightly more liberal SBERT interpretation
      const liberalSbert = Math.min(1, sbertScore * 1.1);
      return {
        strengths: "N/A",
        improvements: "N/A",
        score: parseFloat((liberalSbert * maxMarks).toFixed(1)),
        feedback: "Evaluation fallback triggered due to an error.",
        reasoning: "SBERT similarity (with liberal adjustment) used as score.",
        isValid: sbertScore > 0.2,
        wordCount: studentWords,
        maxMarks: maxMarks,
        sbertScore: sbertScore
      };
    }

    // Apply a "Liberal Boost" (10%) to the AI's score to better match human generosity
    const rawScore = result.score || 0;
    const liberalScore = Math.min(1, rawScore * 1.1);
    const qualityScore = Math.max(0, liberalScore);
    
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
