import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

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
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        You are an expert academic evaluator. Evaluate the following student answer against the reference answer for the given question.
        
        Question: ${question}
        Reference Answer: ${reference}
        Student Answer: ${studentAnswer}
        Max Marks: ${maxMarks}
        
        Evaluation Guidelines:
        1. semanticSimilarity: How well does the student's answer capture the core concepts of the reference answer? (0.0 to 1.0)
        2. grammarScore: Rate the language quality, clarity, and technical correctness of the student's answer. (0.0 to 1.0)
        3. feedback: Provide 2-3 sentences of constructive and encouraging feedback.
        4. strengths: Identify one specific thing the student did well.
        5. improvements: Identify one specific area for improvement.
        
        Provide the evaluation in JSON format with these exact keys:
        - semanticSimilarity
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
            semanticSimilarity: { type: Type.NUMBER },
            grammarScore: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            strengths: { type: Type.STRING },
            improvements: { type: Type.STRING }
          },
          required: ["semanticSimilarity", "grammarScore", "feedback", "strengths", "improvements"]
        }
      }
    });

    const result = JSON.parse(response.text);
    
    // Final Marks Calculation: (semantic_score × 0.75 + grammar_score × 0.25) × max_marks
    const finalScore = (result.semanticSimilarity * 0.75 + result.grammarScore * 0.25) * maxMarks;

    return {
      semanticScore: result.semanticSimilarity,
      grammarScore: result.grammarScore,
      score: parseFloat(finalScore.toFixed(1)),
      feedback: result.feedback,
      strengths: result.strengths,
      improvements: result.improvements
    };
  } catch (error) {
    console.error("Evaluation error:", error);
    // Fallback logic
    const semanticScore = 0.5; // Neutral fallback
    return {
      semanticScore,
      grammarScore: 0.5,
      score: maxMarks * 0.5,
      feedback: "Evaluation fallback triggered due to an error.",
      strengths: "Answer received.",
      improvements: "Please check for technical issues."
    };
  }
}
