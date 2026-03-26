import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { ModelType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function evaluateModel(model: ModelType, prompt: string) {
  const startTime = performance.now();
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });
    const endTime = performance.now();
    return {
      response: response.text || "No response generated.",
      latency: Math.round(endTime - startTime),
      modelId: model,
    };
  } catch (error) {
    console.error(`Error evaluating model ${model}:`, error);
    return {
      response: "Error: Failed to generate response.",
      latency: 0,
      modelId: model,
    };
  }
}
