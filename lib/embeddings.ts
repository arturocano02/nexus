import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export function embeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!embeddingsAvailable() || texts.length === 0) {
    return texts.map(() => new Array(1536).fill(0));
  }

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}
