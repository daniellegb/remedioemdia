import { GoogleGenAI } from "@google/genai";
import { Medication, Appointment } from "../../types";

// Initialize the GoogleGenAI client with the API key from environment variables
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || "" });

export const getHealthInsights = async (meds: Medication[], appointments: Appointment[]) => {
  try {
    const prompt = `Analise os seguintes dados de saúde e dê dicas curtas (máximo 3) em português:
    Medicamentos: ${meds.map(m => `${m.name} (${m.currentStock}/${m.totalStock})`).join(', ')}
    Consultas: ${appointments.map(a => `${a.doctor} - ${a.specialty} em ${a.date}`).join(', ')}
    Foque em estoque baixo e preparação para consultas.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt
    });

    return response.text || "Sem insights no momento.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Erro ao carregar insights inteligentes.";
  }
};
