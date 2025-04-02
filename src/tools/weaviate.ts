import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import weaviate from 'weaviate-client';
import { z } from 'zod';

export function regWeaviateTool(server: McpServer) {
  server.tool(
    'Weaviate Hybrid Search with Extension',
    'Hybrid search in Weaviate with context extension',
    { collection: z.string(), query: z.string(), topK: z.number(), extK: z.number().min(0) },
    async ({ collection, query, topK, extK }, extra) => {
      const client = await weaviate.connectToCustom({
        httpHost: 'localhost',
        httpPort: 8080,
        grpcHost: 'localhost',
        grpcPort: 50051,
        // grpcSecure: true,
        // httpSecure: true,
        // authCredentials: new weaviate.ApiKey('WEAVIATE_INSTANCE_API_KEY'),
        // headers: {
        //   'X-Cohere-Api-Key': Deno.env.get('COHERE_API_KEY') ?? ''
        // }
      });

      const index = client.collections.get(collection);
      // console.log({ level: "info", data: `Performing hybrid search on collection: ${collection}` });

      const hybridResults = await index.query.hybrid(query, {
        targetVector: 'content',
        queryProperties: ['content'],
        returnProperties: ['content', 'source', 'doc_chunk_id'],
        returnMetadata: ['score', 'explainScore'],
        limit: topK,
      });

      if (extK == 0) {
        return {
          content: hybridResults.objects.map((obj) => ({
            type: 'text',
            text: JSON.stringify(
              {
                content: obj.properties.content,
                source: obj.properties.source || '',
              },
              null,
              2,
            ),
          })),
        };
      }

      const docChunks: Record<string, Array<{ chunkId: number; content: string }>> = {};
      const docSources: Record<string, string> = {};
      const addedChunks = new Set<string>();
      const chunksToFetch: string[] = [];

      for (const result of hybridResults.objects) {
        const { content, doc_chunk_id, source } = result.properties;
        // Ensure doc_chunk_id is a string before splitting
        const docChunkId = String(doc_chunk_id);
        const [docUuid, chunkIdStr] = docChunkId.split('_');
        const chunkId = parseInt(chunkIdStr, 10);

        docSources[docUuid] = source ? String(source) : '';
        if (!docChunks[docUuid]) docChunks[docUuid] = [];

        const contentStr = content ? String(content) : '';
        docChunks[docUuid].push({ chunkId, content: contentStr });
        addedChunks.add(`${docUuid}_${chunkId}`);

        const index = client.collections.get(collection);
        const aggregateResult = await index.aggregate.overAll({
          filters: index.filter.byProperty('doc_chunk_id').like(`${docUuid}*`),
        });

        const totalChunkCount = aggregateResult.totalCount || 0; // Total number of chunks for this document

        for (let i = 1; i <= extK; i++) {
          const prevChunk = chunkId - i;
          if (prevChunk >= 0 && !addedChunks.has(`${docUuid}_${prevChunk}`)) {
            chunksToFetch.push(`${docUuid}_${prevChunk}`);
            addedChunks.add(`${docUuid}_${prevChunk}`);
          }

          const nextChunk = chunkId + i;
          if (nextChunk < totalChunkCount && !addedChunks.has(`${docUuid}_${nextChunk}`)) {
            chunksToFetch.push(`${docUuid}_${nextChunk}`);
            addedChunks.add(`${docUuid}_${nextChunk}`);
          }
        }
      }

      const fetchedChunks = await Promise.all(
        chunksToFetch.map(async (chunkId) => {
          const fetchResult = await index.query.fetchObjects({
            filters: index.filter.byProperty('doc_chunk_id').equal(chunkId),
          });
          return fetchResult.objects[0];
        }),
      );

      fetchedChunks.forEach((obj) => {
        if (obj && obj.properties) {
          const { content, doc_chunk_id, source } = obj.properties;
          const docChunkId = String(doc_chunk_id);
          const [docUuid, chunkIdStr] = docChunkId.split('_');
          const chunkId = parseInt(chunkIdStr, 10);

          if (!docChunks[docUuid]) docChunks[docUuid] = [];
          if (!docSources[docUuid]) docSources[docUuid] = source ? String(source) : '';

          const contentStr = content ? String(content) : '';
          docChunks[docUuid].push({ chunkId, content: contentStr });
        } else {
          console.error('Invalid fetched chunk:', obj);
        }
      });

      const docsList = Object.entries(docChunks).map(([docUuid, chunks]) => {
        chunks.sort((a, b) => a.chunkId - b.chunkId);
        return {
          content: chunks.map((c) => c.content).join(''),
          source: docSources[docUuid],
        };
      });

      return {
        content: docsList.map((doc) => ({
          type: 'text',
          text: JSON.stringify({ content: doc.content, source: doc.source }, null, 2),
        })),
      };
    },
  );
}
