import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { glob } from 'glob';
import OpenAI from 'openai';
import { config } from './config.js';
import { resolveWorkspacePath } from './paths.js';

interface CodeChunk {
    path: string;
    text: string;
    embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class CodebaseIndexer {
    private openai: OpenAI;
    private indexFile: string;
    private chunks: CodeChunk[] = [];
    private model = 'nvidia/llama-3.2-nv-embedqa-1b-v2';

    constructor(rootPath: string) {
        this.openai = new OpenAI({
            apiKey: config.nvidiaApiKey,
            baseURL: config.nvidiaBaseUrl,
        });
        this.indexFile = path.join(rootPath, '.murphy_index.json');
    }

    private async loadIndex(): Promise<boolean> {
        if (existsSync(this.indexFile)) {
            try {
                const raw = await fs.readFile(this.indexFile, 'utf-8');
                this.chunks = JSON.parse(raw);
                return true;
            } catch {
                // Ignore corruption
            }
        }
        return false;
    }

    private async saveIndex(): Promise<void> {
        await fs.writeFile(this.indexFile, JSON.stringify(this.chunks, null, 2), 'utf-8');
    }

    private chunkText(filePath: string, text: string): Omit<CodeChunk, 'embedding'>[] {
        const lines = text.split('\n');
        const chunkSize = 30;
        const overlap = 5;
        const chunks: Omit<CodeChunk, 'embedding'>[] = [];

        for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
            const chunkLines = lines.slice(i, i + chunkSize);
            if (chunkLines.length === 0) break;
            const chunkText = chunkLines.join('\n');
            if (chunkText.trim().length < 50) continue; // Skip tiny empty blocks

            chunks.push({
                path: filePath,
                text: chunkText,
            });

            if (i + chunkSize >= lines.length) break;
        }

        return chunks;
    }

    public async indexWorkspace(): Promise<string> {
        const alreadyIndexed = await this.loadIndex();
        if (alreadyIndexed && this.chunks.length > 0) {
            return `ℹ️ Loaded ${this.chunks.length} semantic code chunks from local index cache.`;
        }

        const files = await glob('**/*', {
            cwd: config.defaultCwd,
            ignore: ['node_modules/**', 'dist/**', '.git/**', '.planning/**', '.murphy_index.json', 'package-lock.json'],
            nodir: true,
        });

        const allChunksToEmbed: Omit<CodeChunk, 'embedding'>[] = [];

        for (const file of files) {
            const fullPath = resolveWorkspacePath(file);
            try {
                const stat = await fs.stat(fullPath);
                if (stat.size > 1024 * 1024) continue; // Skip files > 1MB for speed
                const content = await fs.readFile(fullPath, 'utf-8');
                const fileChunks = this.chunkText(file, content);
                allChunksToEmbed.push(...fileChunks);
            } catch {
                // Skip unreadable files
            }
        }

        if (allChunksToEmbed.length === 0) {
            return `ℹ️ No code files found to index.`;
        }

        // Fetch embeddings in batches of 16 to respect rate limits
        const batchSize = 16;
        for (let i = 0; i < allChunksToEmbed.length; i += batchSize) {
            const batch = allChunksToEmbed.slice(i, i + batchSize);
            try {
                const response = await this.openai.embeddings.create({
                    model: this.model,
                    input: batch.map(c => c.text),
                    encoding_format: 'float',
                });

                response.data.forEach((item, index) => {
                    this.chunks.push({
                        ...batch[index],
                        embedding: item.embedding,
                    });
                });
            } catch (err: any) {
                return `❌ Embedding generation failed at batch ${i}: ${err.message}`;
            }
        }

        await this.saveIndex();
        return `✅ Successfully indexed ${files.length} files into ${this.chunks.length} semantic chunks.`;
    }

    public async search(query: string, limit = 5): Promise<string> {
        if (this.chunks.length === 0) {
            await this.indexWorkspace();
        }

        if (this.chunks.length === 0) {
            return `ℹ️ Workspace index is empty.`;
        }

        // Get query embedding
        const response = await this.openai.embeddings.create({
            model: this.model,
            input: [query],
            encoding_format: 'float',
        });

        const queryEmbedding = response.data[0].embedding;

        // Perform cosine similarity comparison
        const scored = this.chunks.map(chunk => ({
            chunk,
            score: cosineSimilarity(queryEmbedding, chunk.embedding),
        }));

        scored.sort((a, b) => b.score - a.score);

        const results = scored.slice(0, limit).map((item, idx) => {
            const lines = item.chunk.text.split('\n');
            const preview = lines.slice(0, 5).join('\n') + (lines.length > 5 ? '\n...' : '');
            return `[Match #${idx + 1}] File: ${item.chunk.path} (Similarity: ${(item.score * 100).toFixed(1)}%)\n\`\`\`\n${preview}\n\`\`\``;
        });

        return `Semantic Search Results for "${query}":\n\n${results.join('\n\n')}`;
    }
}
