import { GoogleGenAI, Type } from "@google/genai";
import { pipeline, cos_sim } from "@xenova/transformers";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Lazy-load the BERT model for semantic similarity
let extractor: any = null;

async function getExtractor() {
  if (!extractor) {
    console.log("Loading BERT model (Xenova/all-MiniLM-L6-v2) for semantic evaluation...");
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log("BERT model loaded successfully.");
  }
  return extractor;
}

export async function evaluateAnswer(question: string, reference: string | undefined, studentAnswer: string, maxMarks: number) {
  // If no reference answer, award full marks (as per requirements)
  if (!reference || reference.trim() === "") {
    return {
      semanticScore: 1.0,
      grammarScore: 1.0,
      score: maxMarks,
      feedback: "Answer accepted as no reference was provided.",
      strengths: "Good attempt.",
      improvements: "N/A"
    };
  }

  try {
    // 1. BERT Semantic Similarity
    const extract = await getExtractor();
    const [refOutput, studentOutput] = await Promise.all([
      extract(reference, { pooling: 'mean', normalize: true }),
      extract(studentAnswer, { pooling: 'mean', normalize: true })
    ]);

    const semanticSimilarity = cos_sim(refOutput.data, studentOutput.data);
    
    // 2. Word Count Analysis
    const refWords = reference.trim().split(/\s+/).length;
    const studentWords = studentAnswer.trim().split(/\s+/).length;
    const wordRatio = Math.min(1.2, studentWords / refWords); // Cap at 1.2 to avoid rewarding excessive fluff

    // 3. Gemini for Completeness, Grammar & Feedback
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        You are an expert academic evaluator. A student has answered a question, and a BERT model has calculated a semantic similarity score of ${semanticSimilarity.toFixed(2)} against the reference answer.
        
        Question: ${question}
        Reference Answer: ${reference} (Word count: ${refWords})
        Student Answer: ${studentAnswer} (Word count: ${studentWords})
        Max Marks: ${maxMarks}
        BERT Similarity Score: ${semanticSimilarity.toFixed(2)}
        
        Evaluation Guidelines:
        1. completenessScore: How much of the key information from the reference answer is present in the student's answer? (0.0 to 1.0)
        2. grammarScore: Rate the language quality, clarity, and technical correctness. (0.0 to 1.0)
        3. feedback: Provide 2-3 sentences of constructive and encouraging feedback.
        4. strengths: Identify one specific thing the student did well.
        5. improvements: Identify one specific area for improvement.
        
        Provide the evaluation in JSON format with these exact keys:
        - completenessScore
        - grammarScore
        - feedback
        - strengths
        - improvements
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            completenessScore: { type: Type.NUMBER },
            grammarScore: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            strengths: { type: Type.STRING },
            improvements: { type: Type.STRING }
          },
          required: ["completenessScore", "grammarScore", "feedback", "strengths", "improvements"]
        }
      }
    });

    const result = JSON.parse(response.text);
    
    /**
     * Justifiable Marking Formula:
     * - 60% Semantic Similarity (BERT) - Core meaning
     * - 25% Completeness (Gemini) - Coverage of key points
     * - 15% Grammar & Clarity (Gemini) - Presentation
     * 
     * Length Factor: We apply a slight penalty if the answer is significantly shorter 
     * than the reference, but we don't penalize conciseness if the meaning is there.
     */
    const lengthPenalty = studentWords < refWords * 0.4 ? 0.8 : 1.0;
    
    // Combine scores
    const weightedScore = (
      semanticSimilarity * 0.60 + 
      result.completenessScore * 0.25 + 
      result.grammarScore * 0.15
    );

    // Apply length penalty and scale to maxMarks
    let finalScore = weightedScore * maxMarks * lengthPenalty;

    // Ensure marks are not "deflated" for high-similarity answers
    if (semanticSimilarity > 0.85 && result.completenessScore > 0.8) {
      finalScore = Math.max(finalScore, maxMarks * 0.9);
    }

    // Clamp score between 0 and maxMarks
    finalScore = Math.max(0, Math.min(maxMarks, finalScore));

    return {
      semanticScore: semanticSimilarity,
      grammarScore: result.grammarScore,
      score: parseFloat(finalScore.toFixed(1)),
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements
    };
  } catch (error) {
    console.error("Evaluation error:", error);
    // Fallback logic
    return {
      semanticScore: 0.5,
      grammarScore: 0.5,
      score: maxMarks * 0.5,
      feedback: "Evaluation fallback triggered due to an error.",
      strengths: "Answer received.",
      improvements: "Please check for technical issues."
    };
  }
}
