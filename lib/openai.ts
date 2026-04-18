import OpenAI from "openai";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "",
});

export async function generateEmbedding(text: string): Promise<number[]> {
    if (!process.env.OPENAI_API_KEY) {
        console.warn("OPENAI_API_KEY not found. Returning zero vector.");
        return new Array(1536).fill(0);
    }

    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: text.replace(/\n/g, " "),
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error("Error generating embedding:", error);
        throw error;
    }
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (!process.env.OPENAI_API_KEY) {
        return texts.map(() => new Array(1536).fill(0));
    }

    try {
        const response = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: texts.map(t => t.replace(/\n/g, " ")),
        });
        return response.data.map(d => d.embedding);
    } catch (error) {
        console.error("Error generating embeddings batch:", error);
        throw error;
    }
}
