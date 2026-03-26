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
    
    // 2. Gemini for Feedback & Grammar
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        You are an expert academic evaluator. A student has answered a question, and a BERT model has calculated a semantic similarity score of ${semanticSimilarity.toFixed(2)} against the reference answer.
        
        Question: ${question}
        Reference Answer: ${reference}
        Student Answer: ${studentAnswer}
        Max Marks: ${maxMarks}
        BERT Similarity Score: ${semanticSimilarity.toFixed(2)}
        
        Evaluation Guidelines:
        1. grammarScore: Rate the language quality, clarity, and technical correctness of the student's answer. (0.0 to 1.0)
        2. feedback: Provide 2-3 sentences of constructive and encouraging feedback based on the student's answer and the BERT similarity score.
        3. strengths: Identify one specific thing the student did well.
        4. improvements: Identify one specific area for improvement.
        
        Provide the evaluation in JSON format with these exact keys:
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
            grammarScore: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            strengths: { type: Type.STRING },
            improvements: { type: Type.STRING }
          },
          required: ["grammarScore", "feedback", "strengths", "improvements"]
        }
      }
    });

    const result = JSON.parse(response.text);
    
    // Final Marks Calculation: (semantic_score × 0.8 + grammar_score × 0.2) × max_marks
    // We use a slightly higher weight for semantic similarity as requested.
    // We also apply a small boost to avoid "deflated" marks for good answers that use different wording.
    const adjustedSemantic = Math.min(1.0, semanticSimilarity * 1.1); 
    const finalScore = (adjustedSemantic * 0.8 + result.grammarScore * 0.2) * maxMarks;

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
